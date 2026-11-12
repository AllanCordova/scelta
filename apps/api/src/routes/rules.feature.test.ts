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
});
