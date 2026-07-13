import { z } from "zod";

const serverConfigSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  APP_VERSION: z.string().trim().min(1).max(100),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerConfig = {
  appEnv: z.infer<typeof serverConfigSchema>["APP_ENV"];
  appVersion: string;
  logLevel: z.infer<typeof serverConfigSchema>["LOG_LEVEL"];
};

export class ConfigError extends Error {
  readonly code = "INVALID_SERVER_CONFIG";

  constructor(readonly invalidKeys: readonly string[]) {
    super(`Invalid server configuration: ${invalidKeys.join(", ")}`);
    this.name = "ConfigError";
  }
}

export function loadServerConfig(environment: Record<string, string | undefined>): ServerConfig {
  const result = serverConfigSchema.safeParse(environment);
  if (!result.success) {
    const invalidKeys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? "environment")))].sort();
    throw new ConfigError(invalidKeys);
  }

  return {
    appEnv: result.data.APP_ENV,
    appVersion: result.data.APP_VERSION,
    logLevel: result.data.LOG_LEVEL,
  };
}
