import { describe, expect, it } from "vitest";
import { inviteUrl, quorumDraftFromPreset } from "./room-draft";

describe("quorumDraftFromPreset", () => {
  it("copies the preset quorum into the form", () => {
    expect(
      quorumDraftFromPreset({
        preset: "ipb_local_officers",
        quorumValue: 34,
        quorumUnit: "percent",
        majorityRule: "absolute_majority",
        roundBehavior: "rounds",
      }),
    ).toEqual({ quorumValue: "34", quorumUnit: "percent" });
  });

  it("leaves quorum empty for a custom preset", () => {
    expect(
      quorumDraftFromPreset({
        preset: "custom",
        quorumValue: null,
        quorumUnit: null,
        majorityRule: "absolute_majority",
        roundBehavior: "manual",
      }),
    ).toEqual({ quorumValue: "", quorumUnit: "percent" });
  });
});

describe("inviteUrl", () => {
  it("joins the origin and the invite path", () => {
    expect(inviteUrl("http://127.0.0.1:5173/", "/join/abc")).toBe(
      "http://127.0.0.1:5173/join/abc",
    );
  });
});
