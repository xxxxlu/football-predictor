import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, normalizeLocale, translate } from "./locale";
import { getLocalizedPageCopy } from "./messages";

describe("locale helpers", () => {
  it("accepts only supported persisted locales", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("de")).toBe("de");
    expect(normalizeLocale("es")).toBe("es");
    expect(normalizeLocale("fr")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("returns translated shared interface copy", () => {
    expect(translate("en", "nav.rooms")).toBe("Groups");
    expect(translate("zh-CN", "auth.login")).toBe("登录");
    expect(translate("de", "nav.rooms")).toBe("Gruppen");
    expect(translate("es", "nav.rooms")).toBe("Grupos");
    expect(translate("de", "odds.fractional")).toBe("Bruch");
    expect(translate("es", "odds.fractional")).toBe("Fraccionario");
  });

  it("retrieves localized page copies across languages", () => {
    expect(getLocalizedPageCopy("我的房间", "zh-CN")).toBeUndefined();
    expect(getLocalizedPageCopy("我的房间", "en")?.title).toBe("My groups");
    expect(getLocalizedPageCopy("我的房间", "de")?.title).toBe("Meine Gruppen");
    expect(getLocalizedPageCopy("我的房间", "es")?.title).toBe("Mis salas");
  });
});

