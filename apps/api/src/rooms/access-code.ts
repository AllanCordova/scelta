import { randomInt } from "node:crypto";
import { ACCESS_CODE_ALPHABET, ACCESS_CODE_LENGTH } from "@scelta/domain";

export function generateAccessCode(): string {
  let code = "";
  for (let i = 0; i < ACCESS_CODE_LENGTH; i += 1) {
    code += ACCESS_CODE_ALPHABET[randomInt(0, ACCESS_CODE_ALPHABET.length)];
  }
  return code;
}
