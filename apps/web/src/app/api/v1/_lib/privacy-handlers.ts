import { AuthError } from "@pulse/domain";
import { OperationError, PostgresPrivacyRepository } from "@pulse/db";
import { z } from "zod";
import { readSessionToken } from "../auth/_lib/session-token";
import { assertSameOrigin } from "./request-origin";
import { deviceInfoSchema, preferencesSchema } from "./privacy-input";

type DataType = "PHOTO" | "LOCATION" | "DEVICE_INFO" | "PREFERENCES";

const DATA_TYPES = ["PHOTO", "LOCATION", "DEVICE_INFO", "PREFERENCES"] as const;

const consentUpdateSchema = z
  .object({
    dataType: z.enum(DATA_TYPES),
    consented: z.boolean(),
  })
  .strict();

const locationSchema = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().optional(),
    altitude: z.number().optional().nullable(),
    altitudeAccuracy: z.number().nonnegative().optional().nullable(),
    heading: z.number().min(0).max(360).optional().nullable(),
    speed: z.number().nonnegative().optional().nullable(),
    timestamp: z.number().optional(),
  })
  .strict();

/** One ceiling for the photo, matching what the schema already declared. */
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** Base64 inflates by 4/3, plus the `data:image/...;base64,` prefix and CRLFs. */
const PHOTO_MAX_DATA_URL_CHARS = Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 1024;

/** Decoded byte count of a base64 data URL payload, without decoding it. */
function dataUrlByteLength(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1).replace(/[\r\n]/g, "");
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

const photoSchema = z
  .object({
    fileName: z.string().max(255).optional(),
    fileSize: z.number().int().positive().max(PHOTO_MAX_BYTES).optional(),
    fileType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]).optional(),
    dataUrl: z.string()
      .max(PHOTO_MAX_DATA_URL_CHARS)
      .regex(/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/),
  })
  .strict()
  // `fileSize` is client-declared and optional, so it bounded nothing: a 2 MB
  // declaration could accompany a 2.25 MB payload, and omitting the field bounded
  // even less. The ceiling is enforced on the bytes that actually get stored.
  .superRefine((input, ctx) => {
    if (dataUrlByteLength(input.dataUrl) > PHOTO_MAX_BYTES) {
      ctx.addIssue({ code: "custom", path: ["dataUrl"], message: "Photo exceeds the maximum size." });
    }
  });

interface Identity {
  authenticate(token: string): Promise<{ id: string } | null>;
  requireCapability(token: string, capability: string): Promise<{ id: string }>;
}

export function createPrivacyHandlers(identity: Identity, repository: PostgresPrivacyRepository) {
  const user = async (request: Request) => {
    const token = readSessionToken(request);
    const account = token ? await identity.authenticate(token) : null;
    if (!account) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return account.id;
  };
  const adminUser = async (request: Request, capability: string) => {
    const token = readSessionToken(request);
    if (!token) throw new AuthError("UNAUTHENTICATED", 401, "Log in to continue.");
    return (await identity.requireCapability(token, capability)).id;
  };

  return {
    /** GET /api/v1/privacy/consent — list all consent records for the current user */
    consentList: (request: Request) =>
      execute(async () => {
        const id = await user(request);
        const consents = await repository.listConsent(id);
        // Return all four data types, filling in defaults for missing ones
        const full: Record<string, { dataType: DataType; consented: boolean }> = {};
        for (const dt of DATA_TYPES) {
          full[dt] = { dataType: dt, consented: false };
        }
        for (const c of consents) {
          full[c.dataType] = { dataType: c.dataType, consented: c.consented };
        }
        return json({ data: { consents: Object.values(full), collectedData: await repository.listCollectedData(id, 100) } });
      }),

    /** POST /api/v1/privacy/consent — update consent for a data type */
    consentUpdate: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const input = consentUpdateSchema.parse(await request.json());
        const result = await repository.upsertConsent(id, input.dataType, input.consented);
        return json({ data: { id: result.id, dataType: result.dataType, consented: result.consented } });
      }),

    /** POST /api/v1/privacy/device — submit device info (requires consent) */
    deviceSubmit: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const hasConsent = await repository.hasConsent(id, "DEVICE_INFO");
        if (!hasConsent) throw new OperationError("CONSENT_REQUIRED", 403);
        const input = deviceInfoSchema.parse(await request.json());
        const result = await repository.storeCollectedData(
          id, "DEVICE_INFO", input,
          request.headers.get("x-forwarded-for") ?? undefined,
          request.headers.get("user-agent") ?? undefined,
        );
        return json({ data: { id: result.id, collectedAt: result.collectedAt } });
      }),

    /** POST /api/v1/privacy/location — submit location (requires consent) */
    locationSubmit: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const hasConsent = await repository.hasConsent(id, "LOCATION");
        if (!hasConsent) throw new OperationError("CONSENT_REQUIRED", 403);
        const input = locationSchema.parse(await request.json());
        const result = await repository.storeCollectedData(
          id, "LOCATION", input,
          request.headers.get("x-forwarded-for") ?? undefined,
          request.headers.get("user-agent") ?? undefined,
        );
        return json({ data: { id: result.id, collectedAt: result.collectedAt } });
      }),

    /** POST /api/v1/privacy/photo — submit photo (requires consent) */
    photoSubmit: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const hasConsent = await repository.hasConsent(id, "PHOTO");
        if (!hasConsent) throw new OperationError("CONSENT_REQUIRED", 403);
        const input = photoSchema.parse(await request.json());
        const result = await repository.storeCollectedData(
          id, "PHOTO", {
            fileName: input.fileName,
            // The measured byte count, not the client's claim about it: the stored
            // record is what an operator reads, so it must describe the payload
            // that is actually there rather than whatever the uploader asserted.
            fileSize: dataUrlByteLength(input.dataUrl),
            fileType: input.fileType,
            // dataUrl is stored as-is; in production you'd upload to blob storage
            dataUrl: input.dataUrl,
          },
          request.headers.get("x-forwarded-for") ?? undefined,
          request.headers.get("user-agent") ?? undefined,
        );
        return json({ data: { id: result.id, collectedAt: result.collectedAt } });
      }),

    /** POST /api/v1/privacy/preferences — submit user preferences (requires consent) */
    preferencesSubmit: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const input = preferencesSchema.parse(await request.json());
        const hasConsent = await repository.hasConsent(id, "PREFERENCES");
        if (!hasConsent) throw new OperationError("CONSENT_REQUIRED", 403);
        const result = await repository.storeCollectedData(
          id, "PREFERENCES", input,
          request.headers.get("x-forwarded-for") ?? undefined,
          request.headers.get("user-agent") ?? undefined,
        );
        return json({ data: { id: result.id, collectedAt: result.collectedAt } });
      }),

    /** DELETE /api/v1/privacy/data — delete all data collected for the current user */
    dataDelete: (request: Request) =>
      execute(async () => {
        assertSameOrigin(request);
        const id = await user(request);
        const deletedCount = await repository.deleteCollectedData(id);
        return json({ data: { deletedCount } });
      }),

    /** GET /api/v1/admin/privacy/data — list all users' data overview (admin) */
    adminDataList: (request: Request) =>
      execute(async () => {
        await adminUser(request, "USER_SECURITY_READ");
        const summary = await repository.listAllUsersDataSummary();
        return json({ data: summary });
      }),

    /** GET /api/v1/admin/privacy/data/[userId] — get user's data detail (admin) */
    adminUserData: (request: Request, userId: string) =>
      execute(async () => {
        await adminUser(request, "USER_SECURITY_READ");
        const detail = await repository.getUserDataDetail(userId);
        return json({ data: detail });
      }),
  };
}

async function execute(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AuthError || error instanceof OperationError) {
      return failure(error.code, error.status);
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return failure("INVALID_REQUEST", 422);
    }
    // Only the error's shape is logged, never the error itself. A postgres.js
    // error carries the failing statement and its bound parameters, which on this
    // module's write paths are exactly the coordinates, device fingerprint and
    // photo bytes the endpoint exists to protect. Same rule as the avatar module.
    console.error("[privacy] unexpected failure", error instanceof Error ? error.name : typeof error);
    return failure("INTERNAL_ERROR", 500);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function failure(code: string, status: number) {
  const message =
    code === "UNAUTHENTICATED" ? "Log in to continue."
    : code === "CONSENT_REQUIRED" ? "You need to grant consent for this data type first."
    : code === "INVALID_REQUEST" ? "Check the submitted fields and try again."
    : code === "INVALID_ORIGIN" ? "Reload this page and try again."
    : code === "FORBIDDEN" ? "You do not have permission to perform this action."
    : code === "RATE_LIMITED" ? "You have submitted this too many times. Try again later."
    : "The request could not be completed.";
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
