import type { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import { createSocketPresencePublisher, isRoomChannelId } from "./realtime.js";

describe("isRoomChannelId", () => {
  it("accepts a room uuid and rejects other channel names", () => {
    expect(isRoomChannelId("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isRoomChannelId("11111111-1111-4111-8111-111111111111 ")).toBe(false);
    expect(isRoomChannelId("room:secret")).toBe(false);
    expect(isRoomChannelId("")).toBe(false);
  });
});

describe("createSocketPresencePublisher", () => {
  it("emits the present count to that room channel", () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const publisher = createSocketPresencePublisher({ to } as unknown as Server);
    const roomId = "11111111-1111-4111-8111-111111111111";

    publisher.publishPresence(roomId, 2);

    expect(to).toHaveBeenCalledWith(`room:${roomId}`);
    expect(emit).toHaveBeenCalledWith("presence", { roomId, presentCount: 2 });
  });
});
