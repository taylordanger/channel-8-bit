/**
 * Broadcast capture: record exactly what viewers get - the canvas plus the station's
 * own audio mix - and stream the recording to the restreamer over a WebSocket.
 * No screen capture or browser extension involved.
 */
export function startIngest(canvas: HTMLCanvasElement, audioOut: MediaStream, url: string, opts: { reconnect?: boolean } = {}): { stop(): void } {
  const video = canvas.captureStream(30).getVideoTracks();
  const stream = new MediaStream([...video, ...audioOut.getAudioTracks()]);
  const mime = ["video/webm;codecs=h264,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
  let recorder: MediaRecorder | undefined;
  let socket: WebSocket | undefined;
  let stopped = false;

  const connect = () => {
    const ws = new WebSocket(url);
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "start", mime }));
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000 });
      recorder.ondataavailable = (e) => {
        if (e.data.size && ws.readyState === WebSocket.OPEN) void e.data.arrayBuffer().then((b) => ws.send(b));
      };
      recorder.start(250);
    };
    ws.onclose = () => {
      if (recorder?.state === "recording") recorder.stop();
      if (!stopped && opts.reconnect !== false) setTimeout(connect, 2000);
    };
  };
  connect();
  return {
    // A finite recording (a clip): flush the last chunk, say we're done, hang up.
    stop() {
      stopped = true;
      const ws = socket;
      if (!recorder || recorder.state !== "recording" || !ws) return;
      recorder.onstop = () => {
        // The final dataavailable fires just before stop; give its arrayBuffer() a moment.
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "done" }));
          ws.close();
        }, 300);
      };
      recorder.stop();
    },
  };
}
