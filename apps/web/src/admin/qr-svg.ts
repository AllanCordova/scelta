import QRCode from "qrcode";

export const QR_PRINT_OPTIONS = {
  errorCorrectionLevel: "Q",
  margin: 4,
} as const;

/**
 * Generates a scalable SVG QR code string with high error correction (Q)
 * and a 4-module quiet zone for reliable camera scanning on printed cards.
 */
export async function generateQrSvg(content: string): Promise<string> {
  if (!content) {
    throw new Error("QR content must not be empty.");
  }

  return QRCode.toString(content, {
    type: "svg",
    ...QR_PRINT_OPTIONS,
  });
}
