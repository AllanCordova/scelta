import { describe, expect, it } from "vitest";
import {
  classifyJoinError,
  formatJoinErrorMessage,
  isTransientJoinError,
  JoinRequestError,
  shouldClearStoredAccessCode,
} from "./join-error";

describe("join-error", () => {
  it("treats network errors, 5xx, and 429 as transient and never clears stored accessCode", () => {
    const networkErr = new TypeError("Failed to fetch");
    const serverErr = new JoinRequestError(503, "service_unavailable");
    const rateErr = new JoinRequestError(429, "rate_limited");

    for (const err of [networkErr, serverErr, rateErr]) {
      expect(isTransientJoinError(err)).toBe(true);
      expect(shouldClearStoredAccessCode(err)).toBe(false);
    }

    expect(classifyJoinError(networkErr)).toBe("transient");
    expect(classifyJoinError(serverErr)).toBe("transient");
    expect(classifyJoinError(rateErr)).toBe("rate_limited");
    expect(formatJoinErrorMessage(rateErr)).toContain("Muitas tentativas");
    expect(formatJoinErrorMessage(networkErr)).toContain("Não foi possível conectar");
  });

  it("handles 409 access_code_in_use without clearing stored accessCode", () => {
    const conflict = new JoinRequestError(409, "access_code_in_use");
    expect(classifyJoinError(conflict)).toBe("conflict_in_use");
    expect(isTransientJoinError(conflict)).toBe(false);
    expect(shouldClearStoredAccessCode(conflict)).toBe(false);
    expect(formatJoinErrorMessage(conflict)).toBe("Este código já está em uso. Procure a mesa.");
  });

  it("only clears stored accessCode on permanent 403/404 auth rejections", () => {
    const invalidCode = new JoinRequestError(403, "invalid_access_code");
    const revokedCode = new JoinRequestError(403, "revoked_access_code");
    const missingInvite = new JoinRequestError(404, "invite_not_found");
    const roomBlocked = new JoinRequestError(409, "room_not_joinable", "draft");

    expect(shouldClearStoredAccessCode(invalidCode)).toBe(true);
    expect(shouldClearStoredAccessCode(revokedCode)).toBe(true);
    expect(shouldClearStoredAccessCode(missingInvite)).toBe(true);
    expect(shouldClearStoredAccessCode(roomBlocked)).toBe(false);

    expect(classifyJoinError(invalidCode)).toBe("permanent_auth");
    expect(classifyJoinError(roomBlocked)).toBe("room_blocked");
    expect(formatJoinErrorMessage(invalidCode)).toContain("Código de acesso inválido ou revogado");
    expect(formatJoinErrorMessage(missingInvite)).toBe("Convite inválido ou expirado.");
    expect(formatJoinErrorMessage(roomBlocked)).toBe("Esta sala ainda não está aberta.");
  });
});
