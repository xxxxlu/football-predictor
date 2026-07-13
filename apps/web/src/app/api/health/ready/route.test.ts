import { describe, expect, it } from "vitest";
import { createReadyResponse } from "./route";

describe("GET /api/health/ready", () => {
  it("returns ready when runtime configuration is valid", async () => {
    const response = createReadyResponse({ APP_ENV: "test", APP_VERSION: "1.0.0" }, "ready-id");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "ready" }, meta: { correlationId: "ready-id" } });
  });

  it("returns 503 without exposing invalid values", async () => {
    const response = createReadyResponse({ APP_ENV: "not-valid", APP_VERSION: "secret-version" }, "unready-id");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "SERVICE_NOT_READY", correlationId: "unready-id" } });
    expect(JSON.stringify(body)).not.toContain("secret-version");
  });
});
