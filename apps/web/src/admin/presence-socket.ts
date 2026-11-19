import { io, type Socket } from "socket.io-client";
import { configuredApiUrl } from "../api-url";

export function connectPresenceSocket(): Socket {
  const origin = configuredApiUrl();
  const options = {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    // Sends the admin session cookie so the server can authorize room:join.
    withCredentials: true,
  };
  return origin.length > 0 ? io(origin, options) : io(options);
}
