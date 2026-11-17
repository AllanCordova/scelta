import { describe, expect, it, vi } from "vitest";
import { hashJoinKey } from "./rooms/join-key.js";
import { authorizeRoomJoin, parseRoomJoinRequest } from "./realtime.js";
import type { RoomRepository } from "./rooms/room-repository.js";
import type { UserRepository } from "./users/user-repository.js";

const ROOM_ID = "11111111-2222-4333-8444-555555555555";

function users(role: "admin" | "member" | null): UserRepository {
  return {
    findBySessionToken: vi.fn(async () => (role ? { id: "u", role } : null)),
  } as unknown as UserRepository;
}

function rooms(access: "present" | "absent" | "revoked" | "missing"): RoomRepository {
  return {
    describeVoterSession: vi.fn(async (_roomId: string, hash: string) =>
      hash === hashJoinKey("good-key") ? access : "missing",
    ),
  } as unknown as RoomRepository;
}

describe("room:join authentication", () => {
  it("parses string and object payloads and rejects malformed ones", () => {
    expect(parseRoomJoinRequest(ROOM_ID)).toEqual({ roomId: ROOM_ID });
    expect(parseRoomJoinRequest({ roomId: ROOM_ID, joinKey: " k " })).toEqual({
      roomId: ROOM_ID,
      joinKey: "k",
    });
    expect(parseRoomJoinRequest("not-a-room")).toBeNull();
    expect(parseRoomJoinRequest({ roomId: ROOM_ID, joinKey: 5 })).toBeNull();
    expect(parseRoomJoinRequest(null)).toBeNull();
  });

  it("accepts an admin session cookie", async () => {
    const allowed = await authorizeRoomJoin({ roomId: ROOM_ID }, "scelta_session=abc", {
      userRepository: users("admin"),
    });
    expect(allowed).toBe(true);
  });

  it("rejects anonymous sockets and non-admin sessions", async () => {
    const anonymous = await authorizeRoomJoin({ roomId: ROOM_ID }, undefined, {
      userRepository: users(null),
    });
    expect(anonymous).toBe(false);
    const member = await authorizeRoomJoin({ roomId: ROOM_ID }, "scelta_session=abc", {
      userRepository: users("member"),
    });
    expect(member).toBe(false);
  });

  it("accepts a participant joinKey and rejects wrong or revoked ones", async () => {
    const deps = { userRepository: users(null), roomRepository: rooms("present") };
    expect(await authorizeRoomJoin({ roomId: ROOM_ID, joinKey: "good-key" }, undefined, deps)).toBe(true);
    expect(await authorizeRoomJoin({ roomId: ROOM_ID, joinKey: "bad-key" }, undefined, deps)).toBe(false);
    const revoked = await authorizeRoomJoin({ roomId: ROOM_ID, joinKey: "good-key" }, undefined, {
      roomRepository: rooms("revoked"),
    });
    expect(revoked).toBe(false);
  });
});
