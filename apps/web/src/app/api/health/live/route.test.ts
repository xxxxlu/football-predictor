import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health/live", () => {
  it("reports process liveness with correlation metadata", async () => {
    const response = await GET(new Request("http://localhost/api/health/live", { headers: { "x-correlation-id": "test-id" } }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: "live" }, meta: { correlationId: "test-id" } });
  });
});
