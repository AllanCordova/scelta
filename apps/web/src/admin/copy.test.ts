import { describe, expect, it } from "vitest";
import { presenceLabel, showsPresence } from "./copy";

describe("presence copy", () => {
  it("pluralizes the present count and only counts open rooms", () => {
    expect(presenceLabel(0)).toBe("0 presentes");
    expect(presenceLabel(1)).toBe("1 presente");
    expect(presenceLabel(2)).toBe("2 presentes");
    expect(showsPresence("open")).toBe(true);
    expect(showsPresence("voting")).toBe(true);
    expect(showsPresence("draft")).toBe(false);
    expect(showsPresence("closed")).toBe(false);
  });
});
