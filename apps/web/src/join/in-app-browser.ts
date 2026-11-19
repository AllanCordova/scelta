export type InAppBrowserInfo = {
  isInApp: boolean;
  appName: string | null;
};

type AppMatcher = {
  appName: string;
  pattern: RegExp;
};

const IN_APP_MATCHERS: readonly AppMatcher[] = [
  { appName: "WhatsApp", pattern: /WhatsApp/i },
  { appName: "Instagram", pattern: /Instagram/i },
  { appName: "Facebook", pattern: /(?:FBAN|FBAV|FB_IAB)/i },
  { appName: "TikTok", pattern: /(?:BytedanceWebview|TikTok|musical_ly)/i },
  { appName: "Line", pattern: /Line\//i },
  { appName: "WeChat", pattern: /MicroMessenger/i },
];

const ANDROID_WV_MARKER = /;\s*wv\)/i;
const ANDROID_VERSION_WEBVIEW = /Android[\s\S]*Version\/\d+\.\d+[\s\S]*Chrome\/\d+[\s\S]*Mobile/i;
const IOS_WEBKIT = /(?:iPhone|iPad|iPod)[\s\S]*AppleWebKit/i;
const IOS_KNOWN_BROWSER = /(?:Safari\/|CriOS\/|FxiOS\/|EdgiOS\/)/i;

/**
 * Detects whether a browser User-Agent belongs to an embedded in-app WebView
 * (e.g. WhatsApp, Instagram, Facebook, TikTok, Line, WeChat, or generic Android/iOS WebViews).
 */
export function detectInAppBrowser(userAgent: string): InAppBrowserInfo {
  const ua = userAgent.trim();
  if (!ua) {
    return { isInApp: false, appName: null };
  }

  for (const matcher of IN_APP_MATCHERS) {
    if (matcher.pattern.test(ua)) {
      return { isInApp: true, appName: matcher.appName };
    }
  }

  if (ANDROID_WV_MARKER.test(ua) || ANDROID_VERSION_WEBVIEW.test(ua)) {
    return { isInApp: true, appName: "Android WebView" };
  }

  if (IOS_WEBKIT.test(ua) && !IOS_KNOWN_BROWSER.test(ua)) {
    return { isInApp: true, appName: "iOS WebView" };
  }

  return { isInApp: false, appName: null };
}
