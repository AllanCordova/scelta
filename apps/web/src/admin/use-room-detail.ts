import { useEffect, useState } from "react";
import { apiUrl } from "../api-url";
import { showsPresence } from "./copy";
import { readPresenceEvent } from "./presence-event";
import { connectPresenceSocket } from "./presence-socket";
import { RoomRequestError, fetchRoomDetail } from "./rooms-api";
import type { RoomDetail } from "./types";

const apiBase = apiUrl("");
const DETAIL_POLL_MS = 2000;

export function useRoomDetail(roomId: string, refreshTick: number) {
  const [room, setRoom] = useState<RoomDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const isRoomActive = room ? showsPresence(room.status) : true;

  useEffect(() => {
    let cancelled = false;
    let isFetching = false;

    async function loadDetail() {
      if (isFetching) {
        return;
      }
      isFetching = true;
      try {
        const detail = await fetchRoomDetail(apiBase, roomId);
        if (!cancelled) {
          setRoom(detail);
          setLoadError(null);
          setLastSyncedAt(new Date());
        }
      } catch (error: unknown) {
        if (!cancelled) {
          if (error instanceof RoomRequestError && error.status === 404) {
            setLoadError("Sala não encontrada.");
          } else {
            setLoadError("Não foi possível carregar os detalhes da sala.");
          }
        }
      } finally {
        isFetching = false;
      }
    }

    void loadDetail();

    const timer = isRoomActive
      ? window.setInterval(() => {
          void loadDetail();
        }, DETAIL_POLL_MS)
      : null;

    const socket = connectPresenceSocket();
    const joinRoomChannel = () => {
      socket.emit("room:join", roomId);
    };

    const handlePresence = (payload: unknown) => {
      const update = readPresenceEvent(payload);
      if (!update || update.roomId !== roomId) {
        return;
      }
      const presence = {
        presentCount: update.presentCount,
        eligibleCount: update.eligibleCount,
        requiredCount: update.requiredCount,
        quorumMet: update.quorumMet,
      };
      setRoom((current) => (current ? { ...current, presence } : current));
      setLastSyncedAt(new Date());
      void loadDetail();
    };

    const handleRoomActivity = (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const record = payload as { roomId?: unknown };
      if (record.roomId === roomId) {
        void loadDetail();
      }
    };

    socket.on("connect", joinRoomChannel);
    socket.on("presence", handlePresence);
    socket.on("round:state", handleRoomActivity);
    socket.on("ballot:activity", handleRoomActivity);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
      socket.off("connect", joinRoomChannel);
      socket.off("presence", handlePresence);
      socket.off("round:state", handleRoomActivity);
      socket.off("ballot:activity", handleRoomActivity);
      socket.disconnect();
    };
  }, [roomId, refreshTick, isRoomActive]);

  return { room, loadError, lastSyncedAt };
}
