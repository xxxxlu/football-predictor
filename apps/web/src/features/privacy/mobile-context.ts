type NavigatorWithMobileContext = Navigator & {
  connection?: {
    type?: string;
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  };
  deviceMemory?: number;
  standalone?: boolean;
  userAgentData?: {
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{
      model?: string;
      platformVersion?: string;
    }>;
  };
};

export async function collectLoginPrivacyContext() {
  const extendedNavigator = navigator as NavigatorWithMobileContext;
  const connection = extendedNavigator.connection;
  const userAgentData = extendedNavigator.userAgentData;
  let highEntropy: { model?: string; platformVersion?: string } = {};

  if (userAgentData?.getHighEntropyValues) {
    try {
      highEntropy = await userAgentData.getHighEntropyValues(["model", "platformVersion"]);
    } catch {
      // Safari and privacy-restricted browsers may expose no high-entropy hints.
    }
  }

  const displayMode = extendedNavigator.standalone || window.matchMedia("(display-mode: standalone)").matches
    ? "standalone"
    : window.matchMedia("(display-mode: fullscreen)").matches
      ? "fullscreen"
      : "browser";
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

  return {
    deviceInfo: compact({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages?.slice(0, 10),
      screenWidth: screen.width,
      screenHeight: screen.height,
      availableScreenWidth: screen.availWidth,
      availableScreenHeight: screen.availHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      colorDepth: screen.colorDepth,
      pixelRatio: window.devicePixelRatio,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      connectionType: connection?.effectiveType,
      networkType: connection?.type,
      downlinkMbps: connection?.downlink,
      roundTripTimeMs: connection?.rtt,
      saveData: connection?.saveData,
      deviceMemory: extendedNavigator.deviceMemory,
      hardwareConcurrency: navigator.hardwareConcurrency,
      maxTouchPoints: navigator.maxTouchPoints,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack || undefined,
      online: navigator.onLine,
      displayMode,
      orientationType: screen.orientation?.type,
      orientationAngle: screen.orientation?.angle,
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      contrast: window.matchMedia("(prefers-contrast: more)").matches ? "more" : "standard",
      navigationType: navigation?.type,
      navigationDurationMs: navigation ? Math.round(navigation.duration) : undefined,
      userAgentData: userAgentData ? compact({
        brands: userAgentData.brands?.slice(0, 10),
        mobile: userAgentData.mobile,
        platform: userAgentData.platform,
        model: highEntropy.model,
        platformVersion: highEntropy.platformVersion,
      }) : undefined,
    }),
    preferences: compact({
      theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
      locale: navigator.language,
      languages: navigator.languages?.slice(0, 10),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      sportPreferences: ["football", "formula-1"],
      notificationEnabled: "Notification" in window && Notification.permission === "granted",
      fontSize: getComputedStyle(document.documentElement).fontSize,
      colorScheme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      contrast: window.matchMedia("(prefers-contrast: more)").matches ? "more" : "standard",
      displayMode,
      privacyPolicyVersion: "privacy-2026-08-07",
    }),
  };
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
