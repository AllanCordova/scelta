import { describe, expect, it } from "vitest";
import { joinTokenFromPath } from "./path";

describe("joinTokenFromPath", () => {
  it("reads the invite token and ignores other pages", () => {
    expect(joinTokenFromPath("/join/exemplo")).toBe("exemplo");
    expect(joinTokenFromPath("/join/abc_def-123/")).toBe("abc_def-123");
    expect(joinTokenFromPath("/join/a%2Fhidden")).toBe("a/hidden");
    expect(joinTokenFromPath("/join")).toBeNull();
    expect(joinTokenFromPath("/join/")).toBeNull();
    expect(joinTokenFromPath("/admin")).toBeNull();
  });
});
