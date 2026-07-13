import { describe, expect, it } from "vitest";
import { ConfigError, loadServerConfig } from "./index.js";

describe("loadServerConfig", () => {
  it("parses a valid runtime environment", () => {
    expect(loadServerConfig({ APP_ENV: "test", APP_VERSION: "1.2.3", LOG_LEVEL: "debug" })).toEqual({
      appEnv: "test",
      appVersion: "1.2.3",
      logLevel: "debug",
    });
  });

  it("fails without required keys and never includes secret values", () => {
    const secret = "never-log-this";
    expect(() => loadServerConfig({ APP_ENV: "invalid", API_FOOTBALL_KEY: secret })).toThrow(ConfigError);
    try {
      loadServerConfig({ APP_ENV: "invalid", API_FOOTBALL_KEY: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("APP_ENV");
      expect(String(error)).toContain("APP_VERSION");
    }
  });
});
