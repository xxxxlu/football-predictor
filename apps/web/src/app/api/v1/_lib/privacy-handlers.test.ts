import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostgresPrivacyRepository } from "@pulse/db";
import { createPrivacyHandlers } from "./privacy-handlers.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function request(path: string, method: string, body?: unknown) {
  return new Request(`https://pulse.test${path}`, {
    method,
    headers: {
      cookie: "fp_session=test-session",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("privacy handlers", () => {
  const identity = {
    authenticate: vi.fn(async () => ({ id: USER_ID })),
    requireCapability: vi.fn(async () => ({ id: USER_ID })),
  };
  const repository = {
    listConsent: vi.fn(async () => []),
    upsertConsent: vi.fn(async (_userId: string, dataType: string, consented: boolean) => ({
      id: "22222222-2222-4222-8222-222222222222",
      userId: USER_ID,
      dataType,
      consented,
      consentedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    hasConsent: vi.fn(async () => true),
    storeCollectedData: vi.fn(async (_userId: string, dataType: string, data: unknown) => ({
      id: "33333333-3333-4333-8333-333333333333",
      userId: USER_ID,
      dataType,
      data,
      collectedAt: new Date().toISOString(),
    })),
    listCollectedData: vi.fn(async () => []),
    deleteCollectedData: vi.fn(async () => 3),
    listAllUsersDataSummary: vi.fn(async () => []),
    getUserDataDetail: vi.fn(async () => ({ consents: [], collectedData: [] })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repository.hasConsent.mockResolvedValue(true);
  });

  it("does not collect data merely because consent was granted", async () => {
    const handlers = createPrivacyHandlers(identity, repository as unknown as PostgresPrivacyRepository);
    const response = await handlers.consentUpdate(request("/api/v1/privacy/consent", "POST", {
      dataType: "DEVICE_INFO",
      consented: true,
    }));

    expect(response.status).toBe(200);
    expect(repository.upsertConsent).toHaveBeenCalledWith(USER_ID, "DEVICE_INFO", true);
    expect(repository.storeCollectedData).not.toHaveBeenCalled();
  });

  it("requires explicit consent before saving preferences", async () => {
    repository.hasConsent.mockResolvedValue(false);
    const handlers = createPrivacyHandlers(identity, repository as unknown as PostgresPrivacyRepository);
    const response = await handlers.preferencesSubmit(request("/api/v1/privacy/preferences", "POST", {
      theme: "dark",
      timezone: "Asia/Taipei",
    }));

    expect(response.status).toBe(403);
    expect(repository.upsertConsent).not.toHaveBeenCalled();
    expect(repository.storeCollectedData).not.toHaveBeenCalled();
  });

  it("accepts timezone and stores preferences after consent", async () => {
    const handlers = createPrivacyHandlers(identity, repository as unknown as PostgresPrivacyRepository);
    const response = await handlers.preferencesSubmit(request("/api/v1/privacy/preferences", "POST", {
      theme: "dark",
      locale: "zh-TW",
      timezone: "Asia/Taipei",
    }));

    expect(response.status).toBe(200);
    expect(repository.storeCollectedData).toHaveBeenCalledWith(
      USER_ID,
      "PREFERENCES",
      expect.objectContaining({ timezone: "Asia/Taipei" }),
      undefined,
      undefined,
    );
  });

  it("rejects oversized photo metadata before writing to the database", async () => {
    const handlers = createPrivacyHandlers(identity, repository as unknown as PostgresPrivacyRepository);
    const response = await handlers.photoSubmit(request("/api/v1/privacy/photo", "POST", {
      fileName: "large.jpg",
      fileSize: 2 * 1024 * 1024 + 1,
      fileType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,AA==",
    }));

    expect(response.status).toBe(422);
    expect(repository.storeCollectedData).not.toHaveBeenCalled();
  });

  it("lets the signed-in user clear previously collected data", async () => {
    const handlers = createPrivacyHandlers(identity, repository as unknown as PostgresPrivacyRepository);
    const response = await handlers.dataDelete(request("/api/v1/privacy/data", "DELETE"));
    const body = await response.json() as { data: { deletedCount: number } };

    expect(response.status).toBe(200);
    expect(repository.deleteCollectedData).toHaveBeenCalledWith(USER_ID);
    expect(body.data.deletedCount).toBe(3);
  });
});
