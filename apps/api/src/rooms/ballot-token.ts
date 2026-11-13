import { randomBytes } from "node:crypto";

/** Random unlinkable token stored on an anonymous ballot row. */
export function createBallotToken(): string {
  return randomBytes(16).toString("base64url");
}
