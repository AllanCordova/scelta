import { describe, expect, it } from "vitest";
import { validateNewAccount } from "./account.js";

describe("validateNewAccount", () => {
  it("normalizes a valid account", () => {
    const result = validateNewAccount({
      name: "  Ana Admin  ",
      email: " Ana@Igreja.Local ",
      password: "senha-segura",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        name: "Ana Admin",
        email: "ana@igreja.local",
        password: "senha-segura",
      },
    });
  });

  it("rejects a short password and a malformed email", () => {
    const result = validateNewAccount({
      name: "",
      email: "ana",
      password: "curta",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual([
        { field: "name", code: "required" },
        { field: "email", code: "invalid" },
        { field: "password", code: "invalid" },
      ]);
    }
  });
});
