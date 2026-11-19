import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectInAppBrowser } from "./in-app-browser";
import { InAppBrowserBanner } from "./InAppBrowserBanner";

describe("detectInAppBrowser", () => {
  it.each([
    [
      "WhatsApp iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21C62 WhatsApp/2.23.24.80",
      "WhatsApp",
    ],
    [
      "WhatsApp Android",
      "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 WhatsApp/2.23.24.82",
      "WhatsApp",
    ],
    [
      "Instagram iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B91 Instagram 311.0.0.21.111 (iPhone15,2; iOS 17_1; pt_BR; pt; scale=3.00; 1179x2556; 544427858)",
      "Instagram",
    ],
    [
      "Facebook FBAN/FBAV",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 [FBAN/FBIOS;FBAV/443.0.0.48.105;FBBV/544348482;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBID/phone;FBLC/pt_BR;FBOP/5]",
      "Facebook",
    ],
    [
      "Facebook FB_IAB",
      "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/442.0.0.44.114;]",
      "Facebook",
    ],
    [
      "TikTok BytedanceWebview",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 BytedanceWebview/d8a21c6",
      "TikTok",
    ],
    [
      "TikTok token",
      "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36 TikTok 32.4.3",
      "TikTok",
    ],
    [
      "TikTok musical_ly",
      "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Mobile Safari/537.36 musical_ly_2023204030",
      "TikTok",
    ],
    [
      "Line",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Safari/604.1 Line/13.19.0",
      "Line",
    ],
    [
      "WeChat",
      "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.43",
      "WeChat",
    ],
    [
      "Android generic WebView (; wv))",
      "Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36",
      "Android WebView",
    ],
    [
      "Android WebView Version/Chrome/Mobile heuristic",
      "Mozilla/5.0 (Linux; Android 11; Moto G) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36",
      "Android WebView",
    ],
    [
      "iOS generic WebView (no Safari/CriOS/FxiOS/EdgiOS)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B91",
      "iOS WebView",
    ],
    [
      "iPad generic WebView",
      "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B91",
      "iOS WebView",
    ],
  ])("detects %s as in-app browser", (_label, userAgent, expectedAppName) => {
    expect(detectInAppBrowser(userAgent)).toEqual({
      isInApp: true,
      appName: expectedAppName,
    });
  });

  it.each([
    ["empty string", ""],
    ["whitespace only", "   "],
    [
      "Chrome on Android",
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
    ],
    [
      "Chrome on Desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    [
      "Safari on iOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    ],
    [
      "Safari on macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    ],
    [
      "Chrome on iOS (CriOS)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    ],
    [
      "Firefox on iOS (FxiOS)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Edge on iOS (EdgiOS)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.2210.126 Version/17.0 Mobile/15E148 Safari/605.1.15",
    ],
    [
      "Firefox on Android",
      "Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0",
    ],
    [
      "Firefox on Desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
    ],
    [
      "Edge on Android",
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.2210.141",
    ],
    [
      "Edge on Desktop",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.121",
    ],
    [
      "Samsung Internet on Android",
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    ],
  ])("returns isInApp: false for %s", (_label, userAgent) => {
    expect(detectInAppBrowser(userAgent)).toEqual({
      isInApp: false,
      appName: null,
    });
  });
});

describe("InAppBrowserBanner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders warning copy with appName and copies the invite link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      createElement(InAppBrowserBanner, {
        appName: "WhatsApp",
        urlToCopy: "https://scelta.example/j/abc123",
      }),
    );

    const warning = screen.getByTestId("in-app-browser-warning");
    expect(warning).toHaveTextContent("WhatsApp");
    expect(warning).toHaveTextContent("Chrome");
    expect(warning).toHaveTextContent("Safari");

    const copyButton = screen.getByTestId("copy-in-app-link");
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://scelta.example/j/abc123");
      expect(copyButton).toHaveTextContent("Link copiado!");
    });

    expect(screen.queryByRole("button", { name: "Continuar mesmo assim" })).not.toBeInTheDocument();
  });

  it("renders optional continue anyway button when callback is provided", () => {
    const onContinueAnyway = vi.fn();

    render(
      createElement(InAppBrowserBanner, {
        appName: null,
        urlToCopy: "https://scelta.example/j/abc123",
        onContinueAnyway,
      }),
    );

    const continueButton = screen.getByRole("button", { name: "Continuar mesmo assim" });
    fireEvent.click(continueButton);
    expect(onContinueAnyway).toHaveBeenCalledTimes(1);
  });
});
