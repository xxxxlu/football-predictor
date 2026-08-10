import { randomUUID } from "node:crypto";
import {
  avatarAuditMetadata,
  avatarObjectKey,
  AvatarStorageError,
  type AvatarStorage,
} from "@pulse/domain";
import { avatarSummary, OperationError, type AvatarRepository, type AvatarSummary, type PendingAvatarObject } from "@pulse/db";
import { AvatarImageError, processAvatarImage } from "./image-pipeline";

/**
 * Avatar upload orchestration (Story 12.6).
 *
 * Two stores have to agree — object storage and Postgres — and there is no
 * transaction spanning them, so the order is chosen so that every crash leaves a
 * recoverable state rather than a wrong one:
 *
 *  1. quota first, in its own committed transaction, so a refused or failed
 *     attempt still costs its unit;
 *  2. decode and re-encode next, so a bad file never reaches the bucket;
 *  3. upload to a *new* random key — never overwrite the live object, so a
 *     failure here leaves the current avatar untouched and the database unread;
 *  4. write the database row; if that fails, delete the object just uploaded
 *     (the compensating action) and surface the original error;
 *  5. only then retire the predecessor. Its delete is already queued inside the
 *     same transaction as the swap, so the immediate attempt is an optimisation:
 *     if it fails, the sweeper finishes the job.
 *
 * The result of that ordering: a crash can leave an unreferenced object in the
 * bucket (harmless, and the queue catches the common cases), but never a database
 * row pointing at an object that does not exist.
 */

/** The privacy-centre surface this service touches. Narrow on purpose. */
export interface PhotoConsentStore {
  listConsent(userId: string): Promise<Array<{ dataType: string; consented: boolean }>>;
  upsertConsent(userId: string, dataType: "PHOTO", consented: boolean): Promise<unknown>;
  storeCollectedData(userId: string, dataType: "PHOTO", data: unknown, ipAddress?: string, userAgent?: string): Promise<unknown>;
}

export interface AvatarServiceDependencies {
  repository: AvatarRepository;
  storage: AvatarStorage;
  privacy: PhotoConsentStore;
  clock?: () => Date;
  newId?: () => string;
}

export interface AvatarUploadContext {
  ipAddress?: string;
  userAgent?: string;
}

export function createAvatarService({
  repository,
  storage,
  privacy,
  clock = () => new Date(),
  newId = randomUUID,
}: AvatarServiceDependencies) {
  /**
   * PHOTO authorization, resolved from the deliberate act rather than from a
   * standing toggle (the 0029 privacy centre is a viewer, not a switchboard):
   *
   *  - an explicit revocation refuses the upload — that is what "revoking PHOTO
   *    stops future uploads" means;
   *  - no record at all means the member has never been asked, and choosing a
   *    photo, cropping it and confirming IS the affirmative act, so consent is
   *    recorded here and the upload proceeds.
   *
   * Neither branch ever deletes an existing avatar: revocation stops new uploads,
   * and removing the current photo stays the account page's explicit action.
   */
  async function requirePhotoConsent(userId: string): Promise<void> {
    const consents = await privacy.listConsent(userId);
    const photo = consents.find((entry) => entry.dataType === "PHOTO");
    if (photo && !photo.consented) throw new OperationError("PHOTO_CONSENT_REVOKED", 403);
    if (!photo) await privacy.upsertConsent(userId, "PHOTO", true);
  }

  /**
   * Best-effort object delete plus queue bookkeeping. Never throws: every caller
   * is on a path that has already succeeded, and the queue is what guarantees
   * eventual removal.
   */
  async function retire(object: PendingAvatarObject | null): Promise<void> {
    if (!object) return;
    try {
      await storage.remove(object);
      await repository.markAvatarObjectDeleted(object.objectKey);
    } catch {
      // No object key, no storage message: the sweeper owns the retry, and this
      // path must not put a bucket path into the logs.
      await repository.recordAvatarObjectDeleteFailure(object.objectKey).catch(() => {});
      console.warn("[avatar] deferred object delete to the sweeper");
    }
  }

  return {
    async getAvatar(userId: string): Promise<AvatarSummary | null> {
      const record = await repository.getAvatar(userId);
      return record ? avatarSummary(record) : null;
    },

    /**
     * Resolves a public media path to bytes. The object key never leaves this
     * call and the temporary URL never leaves the storage adapter, so a private
     * bucket stays private while the browser only ever sees a same-origin path.
     */
    async readMedia(publicId: string, version: number): Promise<{ body: Uint8Array; contentType: string } | null> {
      const record = await repository.getServableAvatar(publicId, version);
      if (!record) return null;
      const object = await storage.read({ objectKey: record.objectKey, fileId: record.fileId });
      return { body: object.body, contentType: record.contentType };
    },

    /**
     * Accepts the member's confirmed crop and publishes it. `input` is the raw
     * uploaded bytes: nothing above this line has inspected them, and nothing
     * below trusts a declared type.
     */
    async upload(userId: string, input: Uint8Array, context: AvatarUploadContext = {}): Promise<AvatarSummary> {
      await requirePhotoConsent(userId);
      // Priced before the work: a rejected file, a storage outage and a success
      // all cost the same unit, so probing the endpoint is never free.
      await repository.consumeAvatarChangeQuota(userId);

      const processed = await processAvatarImage(input);

      // Two independent random ids. `publicId` is what the media URL exposes;
      // the object id is what the bucket path uses. Keeping them separate means
      // a public URL discloses nothing about where the bytes actually live.
      const existing = await repository.getAvatar(userId);
      const publicId = existing?.publicId ?? newId();
      const objectKey = avatarObjectKey(newId(), (existing?.version ?? 0) + 1);

      const { fileId } = await storage.put({
        objectKey,
        body: processed.body,
        contentType: processed.contentType,
      });

      let saved;
      try {
        saved = await repository.saveAvatar({
          userId,
          publicId,
          fileId,
          objectKey,
          contentType: processed.contentType,
          byteSize: processed.byteSize,
          width: processed.width,
          height: processed.height,
        });
      } catch (error) {
        // Compensating delete: the row was never written, so this object is
        // already unreachable and must not be left behind.
        await storage.remove({ objectKey, fileId }).catch(() => {});
        throw error;
      }

      await retire(saved.replaced);
      await recordAuditNote(userId, saved.record.version, processed, context);
      return avatarSummary(saved.record);
    },

    /**
     * Removes the member's own avatar. Idempotent, and it does not touch consent:
     * deleting the photo is not a withdrawal of permission to have one, and the
     * two controls stay independent.
     */
    async remove(userId: string): Promise<{ removed: boolean }> {
      const { removed, object } = await repository.deleteAvatar(userId);
      await retire(object);
      return { removed };
    },

    /** Drains the deletion queue. Safe to call repeatedly; failures stay queued. */
    async sweepPendingObjects(limit = 25): Promise<{ swept: number; failed: number }> {
      const pending = await repository.listPendingAvatarObjects(limit);
      let swept = 0;
      let failed = 0;
      for (const object of pending) {
        try {
          await storage.remove(object);
          await repository.markAvatarObjectDeleted(object.objectKey);
          swept += 1;
        } catch {
          await repository.recordAvatarObjectDeleteFailure(object.objectKey).catch(() => {});
          failed += 1;
        }
      }
      return { swept, failed };
    },
  };

  /**
   * The privacy-centre note. Metadata only — the builder itself refuses a payload
   * key, an EXIF field or an original filename — and a failure here never fails
   * the upload, because the avatar is already published.
   */
  async function recordAuditNote(
    userId: string,
    version: number,
    processed: { byteSize: number; width: number; height: number },
    context: AvatarUploadContext,
  ): Promise<void> {
    try {
      await privacy.storeCollectedData(
        userId,
        "PHOTO",
        avatarAuditMetadata({ ...processed, version, uploadedAt: clock() }),
        context.ipAddress,
        context.userAgent,
      );
    } catch {
      console.warn("[avatar] privacy audit note skipped");
    }
  }
}

export type AvatarService = ReturnType<typeof createAvatarService>;

/**
 * Maps every failure this feature can produce onto the API envelope's stable
 * codes. Storage and database internals collapse to one opaque code on purpose:
 * an error message must never carry a bucket, an object key or SQL text.
 */
export function avatarErrorResponse(error: unknown): { code: string; status: number } | null {
  if (error instanceof AvatarImageError) {
    const status = error.code === "FILE_TOO_LARGE" ? 413 : 422;
    return { code: error.code, status };
  }
  if (error instanceof AvatarStorageError) {
    return { code: error.code === "STORAGE_NOT_CONFIGURED" ? "AVATAR_UNAVAILABLE" : "AVATAR_STORAGE_FAILED", status: 503 };
  }
  return null;
}
