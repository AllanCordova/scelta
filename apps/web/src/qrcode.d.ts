declare module "qrcode" {
  type QrCodeOptions = {
    margin?: number;
    width?: number;
  };

  export function toDataURL(text: string, options?: QrCodeOptions): Promise<string>;

  const qrcode: {
    toDataURL: typeof toDataURL;
  };

  export default qrcode;
}
