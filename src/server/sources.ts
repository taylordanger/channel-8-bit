import dns from "node:dns/promises";
import net from "node:net";
import { parse, type HTMLElement } from "node-html-parser";

/** What the station took from a submitted link. Everything here is untrusted page content. */
export interface Source {
  url: string;
  title: string;
  site: string;
  description: string;
  publishedAt: string;
  /** Main article text, trimmed to MAX_SOURCE_CHARS. */
  text: string;
}

export const MAX_SOURCE_CHARS = 8000;
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 12_000;

export class SourceError extends Error {}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Only public http(s) pages; never the station's own machine or local network. */
export async function assertPublicUrl(raw: string, lookup = dns.lookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourceError("that doesn't look like a link");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new SourceError("only http and https links are supported");
  if (url.username || url.password) throw new SourceError("links with passwords aren't allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new SourceError("local addresses aren't allowed");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => {
    throw new SourceError(`couldn't find ${host}`);
  });
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new SourceError("local network addresses aren't allowed");
  return url;
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Fetch a public page, re-checking every redirect hop, with size and time limits. */
export async function fetchPage(raw: string, fetcher: Fetcher = fetch, lookup = dns.lookup): Promise<{ url: string; html: string }> {
  let current = (await assertPublicUrl(raw, lookup)).toString();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetcher(current, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "Mozilla/5.0 (compatible; Channel8BitDesk/1.0)", accept: "text/html,application/xhtml+xml,text/plain" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new SourceError(`redirect without a destination (${res.status})`);
        current = (await assertPublicUrl(new URL(loc, current).toString(), lookup)).toString();
        continue;
      }
      if (!res.ok) throw new SourceError(`the page answered ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml|text\/plain/.test(type)) throw new SourceError(`not a web page (${type || "unknown type"})`);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > MAX_BYTES) throw new SourceError("page is too large");
      const reader = res.body?.getReader();
      if (!reader) return { url: current, html: await res.text() };
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) {
          await reader.cancel();
          throw new SourceError("page is too large");
        }
        chunks.push(value);
      }
      return { url: current, html: Buffer.concat(chunks).toString("utf8") };
    } catch (e) {
      if (e instanceof SourceError) throw e;
      if ((e as Error).name === "AbortError") throw new SourceError("the page took too long to load");
      throw new SourceError(`couldn't load the page: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SourceError("too many redirects");
}

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Pull the readable parts out of a page: headline, site, date, and the article body. */
export function extractSource(url: string, html: string): Source {
  const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const meta = (...names: string[]) => {
    for (const n of names) {
      const el = root.querySelector(`meta[property="${n}"]`) ?? root.querySelector(`meta[name="${n}"]`);
      const v = clean(el?.getAttribute("content"));
      if (v) return v;
    }
    return "";
  };
  for (const el of root.querySelectorAll("script, style, noscript, svg, nav, header, footer, aside, form, iframe, button")) el.remove();

  const title = meta("og:title", "twitter:title") || clean(root.querySelector("title")?.text) || clean(root.querySelector("h1")?.text);
  const site = meta("og:site_name") || new URL(url).hostname.replace(/^www\./, "");
  const description = meta("og:description", "description", "twitter:description");
  const publishedAt =
    meta("article:published_time", "og:published_time", "date", "pubdate") || clean(root.querySelector("time")?.getAttribute("datetime"));

  // Prefer the article container; fall back to the densest block of paragraphs.
  const container: HTMLElement = root.querySelector("article") ?? root.querySelector("main") ?? root.querySelector("body") ?? root;
  let paras = container
    .querySelectorAll("h1, h2, h3, p, li, blockquote")
    .map((el) => clean(el.text))
    .filter((t) => t.length > 30 || /^#|[.!?]$/.test(t));
  if (paras.join(" ").length < 200) paras = [clean(container.text)];
  const seen = new Set<string>();
  const text = paras
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
    .join("\n")
    .slice(0, MAX_SOURCE_CHARS);

  if (!title && text.length < 80) throw new SourceError("couldn't find any readable text on that page");
  return { url, title: title.slice(0, 300), site: site.slice(0, 100), description: description.slice(0, 500), publishedAt: publishedAt.slice(0, 40), text };
}

export async function readSource(url: string, fetcher?: Fetcher, lookup?: typeof dns.lookup): Promise<Source> {
  const page = await fetchPage(url, fetcher, lookup);
  return extractSource(page.url, page.html);
}

export const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
