declare module "qrcode" {
  type QrCodeOptions = {
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    margin?: number;
    type?: "svg" | "utf8" | "terminal";
    width?: number;
  };

  export function toDataURL(text: string, options?: QrCodeOptions): Promise<string>;
  export function toString(text: string, options?: QrCodeOptions): Promise<string>;

  const qrcode: {
    toDataURL: typeof toDataURL;
    toString: typeof toString;
  };

  export default qrcode;
}
