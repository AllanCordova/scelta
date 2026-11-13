import { describe, expect, it } from "vitest";
import { readPresenceEvent } from "./presence-event";

describe("readPresenceEvent", () => {
  it("accepts a room count and ignores malformed payloads", () => {
    expect(readPresenceEvent({ roomId: "room-1", presentCount: 0 })).toEqual({
      roomId: "room-1",
      presentCount: 0,
    });
    expect(readPresenceEvent({ roomId: "room-1", presentCount: 1.5 })).toBeNull();
    expect(readPresenceEvent({ roomId: "", presentCount: 1 })).toBeNull();
    expect(readPresenceEvent(null)).toBeNull();
  });
});
