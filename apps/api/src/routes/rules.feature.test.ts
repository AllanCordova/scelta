import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("rules feature", () => {
  it("evaluates quorum through the HTTP boundary", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/rules/quorum",
      payload: {
        presentCount: 40,
        eligibleCount: 100,
        quorumValue: 34,
        quorumUnit: "absolute",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ reached: true });

    await app.close();
  });

  it("rejects invalid quorum payloads", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/v1/rules/quorum",
      payload: {
        presentCount: -1,
        eligibleCount: 100,
        quorumValue: 34,
        quorumUnit: "absolute",
      },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("lists rules presets with quorum defaults", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/v1/rules/presets",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().presets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          preset: "ipb_local_officers",
          quorumValue: 34,
          quorumUnit: "percent",
          majorityRule: "absolute_majority",
        }),
        expect.objectContaining({
          preset: "ipb_society_board",
          quorumValue: 51,
          quorumUnit: "percent",
        }),
        expect.objectContaining({
          preset: "custom",
          quorumValue: null,
          quorumUnit: null,
        }),
      ]),
    );

    await app.close();
  });
});
