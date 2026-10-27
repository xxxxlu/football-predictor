import { describe, expect, it } from "vitest";
import { detectPlatform, shouldShowInstallPrompt } from "./install-prompt";

describe("install prompt policy and platform detection", () => {
  it("never shows install prompt if already running in standalone mode", () => {
    expect(shouldShowInstallPrompt({ isStandalone: true })).toBe(false);
  });

  it("does not show install prompt if dismissal cooldown is in the future", () => {
    const now = 1000000;
    expect(
      shouldShowInstallPrompt({
        isStandalone: false,
        dismissedUntilMs: now + 50000,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("shows install prompt if not standalone and cooldown has expired", () => {
    const now = 1000000;
    expect(
      shouldShowInstallPrompt({
        isStandalone: false,
        dismissedUntilMs: now - 50000,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("detects iPhone Safari correctly", () => {
    const iphoneSafari =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1";
    const res = detectPlatform(iphoneSafari);
    expect(res.isIOS).toBe(true);
    expect(res.isSafari).toBe(true);
  });

  it("distinguishes Chrome on iOS (CriOS) from native Safari", () => {
    const crios =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.52 Mobile/15E148 Safari/604.1";
    const res = detectPlatform(crios);
    expect(res.isIOS).toBe(true);
    expect(res.isSafari).toBe(false);
  });

  it("detects Android Chrome as non-iOS", () => {
    const androidChrome =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.80 Mobile Safari/537.36";
    const res = detectPlatform(androidChrome);
    expect(res.isIOS).toBe(false);
    expect(res.isSafari).toBe(false);
  });
});
