import { useEffect, useState } from "react";
import { apiUrl } from "../api-url";
import { showsPresence } from "./copy";
import { readPresenceEvent, type QuorumPresence } from "./presence-event";
import { connectPresenceSocket } from "./presence-socket";
import { fetchPresence } from "./rooms-api";
import type { RoomStatus } from "./types";

const PRESENCE_POLL_MS = 2000;

export function useRoomPresence(
  rooms: { id: string; status: RoomStatus }[],
): Record<string, QuorumPresence> {
  const [counts, setCounts] = useState<Record<string, QuorumPresence>>({});
  const openRoomKey = rooms
    .filter((room) => showsPresence(room.status))
    .map((room) => room.id)
    .join("\n");

  useEffect(() => {
    const roomIds = openRoomKey.length === 0 ? [] : openRoomKey.split("\n");
    if (roomIds.length === 0) {
      return;
    }

    let cancelled = false;
    let epoch = 0;

    const poll = () => {
      const startedEpoch = epoch;
      void loadPresence(roomIds).then((loaded) => {
        if (cancelled || startedEpoch !== epoch) {
          return;
        }
        setCounts((current) => ({ ...current, ...loaded }));
      });
    };

    poll();
    const timer = window.setInterval(poll, PRESENCE_POLL_MS);
    const socket = connectPresenceSocket();
    const joinRooms = () => {
      for (const roomId of roomIds) {
        socket.emit("room:join", roomId);
      }
    };

    socket.on("connect", joinRooms);
    socket.on("presence", (payload: unknown) => {
      const update = readPresenceEvent(payload);
      if (!update || !roomIds.includes(update.roomId)) {
        return;
      }
      epoch += 1;
      const { roomId, ...presence } = update;
      setCounts((current) => ({ ...current, [roomId]: presence }));
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      socket.off("connect", joinRooms);
      socket.disconnect();
    };
  }, [openRoomKey]);

  return counts;
}

async function loadPresence(roomIds: string[]): Promise<Record<string, QuorumPresence>> {
  const entries = await Promise.all(
    roomIds.map(async (roomId) => {
      try {
        return [roomId, await fetchPresence(apiUrl(""), roomId)] as const;
      } catch {
        return null;
      }
    }),
  );

  const counts: Record<string, QuorumPresence> = {};
  for (const entry of entries) {
    if (entry) {
      counts[entry[0]] = entry[1];
    }
  }
  return counts;
}
