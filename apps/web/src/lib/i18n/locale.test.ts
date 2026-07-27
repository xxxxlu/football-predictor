import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, normalizeLocale, translate } from "./locale";

describe("locale helpers", () => {
  it("accepts only supported persisted locales", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("returns translated shared interface copy", () => {
    expect(translate("en", "nav.rooms")).toBe("Groups");
    expect(translate("zh-CN", "auth.login")).toBe("登录");
  });
});
