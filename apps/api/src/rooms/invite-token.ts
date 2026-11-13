import { randomBytes } from "node:crypto";

/** Unguessable capability token for the room invite link and QR code. */
export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}
