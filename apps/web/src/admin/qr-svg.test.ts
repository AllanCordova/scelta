import QRCode from "qrcode";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QR_PRINT_OPTIONS, generateQrSvg } from "./qr-svg";

describe("generateQrSvg", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes print options with error correction Q and margin 4", () => {
    expect(QR_PRINT_OPTIONS).toEqual({
      errorCorrectionLevel: "Q",
      margin: 4,
    });
  });

  it("generates a valid SVG QR code string for a join URL", async () => {
    const svg = await generateQrSvg("https://scelta.example/j/AB12");

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("viewBox=");
    expect(svg).toContain("<path");
  });

  it("passes svg type, errorCorrectionLevel Q, and margin 4 to QRCode.toString", async () => {
    const spy = vi.spyOn(QRCode, "toString");

    await generateQrSvg("https://scelta.example/j/XYZ9");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      "https://scelta.example/j/XYZ9",
      expect.objectContaining({
        type: "svg",
        errorCorrectionLevel: "Q",
        margin: 4,
      }),
    );
  });

  it("rejects empty content", async () => {
    await expect(generateQrSvg("")).rejects.toThrow("QR content must not be empty.");
  });
});
