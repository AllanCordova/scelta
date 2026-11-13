import { describe, expect, it } from "vitest";
import { readPresenceEvent } from "./presence-event";

describe("readPresenceEvent", () => {
  it("accepts presence against the required quorum and ignores malformed payloads", () => {
    expect(
      readPresenceEvent({
        roomId: "room-1",
        presentCount: 1,
        eligibleCount: 10,
        requiredCount: 4,
        quorumMet: false,
      }),
    ).toEqual({
      roomId: "room-1",
      presentCount: 1,
      eligibleCount: 10,
      requiredCount: 4,
      quorumMet: false,
    });
    expect(readPresenceEvent({ roomId: "room-1", presentCount: 0 })).toBeNull();
    expect(readPresenceEvent({ roomId: "room-1", presentCount: -1, eligibleCount: 1, requiredCount: 1, quorumMet: true })).toBeNull();
    expect(readPresenceEvent({ roomId: "room-1", presentCount: 1, eligibleCount: 1, requiredCount: 1, quorumMet: "yes" })).toBeNull();
    expect(readPresenceEvent({ roomId: "room-1", presentCount: 1.5, eligibleCount: 1, requiredCount: 1, quorumMet: true })).toBeNull();
    expect(readPresenceEvent({ roomId: "", presentCount: 1, eligibleCount: 1, requiredCount: 1, quorumMet: true })).toBeNull();
    expect(readPresenceEvent(null)).toBeNull();
  });
});
