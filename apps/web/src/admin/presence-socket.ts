import { io, type Socket } from "socket.io-client";
import { configuredApiUrl } from "../api-url";

export function connectPresenceSocket(): Socket {
  const origin = configuredApiUrl();
  const options = {
    path: "/socket.io",
    transports: ["websocket", "polling"],
  };
  return origin.length > 0 ? io(origin, options) : io(options);
}
