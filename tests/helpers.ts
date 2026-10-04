import { CHARACTERS } from "../src/server/catalog/characters.js";
import { getShow } from "../src/server/catalog/shows.js";
import type { Script, WriterBrief } from "../src/server/writers/script.js";

export const soapBrief = (over: Partial<WriterBrief> = {}): WriterBrief => {
  const show = getShow("pixel_heights");
  return {
    show,
    segmentType: "confrontation",
    topic: "a forged will",
    cast: show.cast.map((id) => CHARACTERS[id]),
    targetSeconds: 60,
    localTime: "Saturday 1:00 PM",
    previously: [],
    memories: [],
    relationships: [],
    storyState: "",
    recentLines: [],
    ...over,
  };
};

export const beat = (speaker: string, line: string, action: Script["beats"][number]["action"] = "none") => ({
  speaker,
  line,
  emotion: "neutral" as const,
  action,
  target: "camera",
  laugh: false,
});

export const script = (beats: Script["beats"], over: Partial<Script> = {}): Script => ({
  title: "Test",
  summary: "Something happened.",
  beats,
  memories: [],
  relationshipChanges: [],
  moodChanges: [],
  storyState: "",
  ...over,
});
