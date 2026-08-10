import type { AvatarStorageConfig } from "@pulse/config";
import { AVATAR_TEMPORARY_URL_TTL_SECONDS, AvatarStorageError, type AvatarStorage } from "@pulse/domain";
import type { CloudBase } from "@cloudbase/node-sdk";

/**
 * The one place the CloudBase SDK is allowed to appear (Story 12.6).
 *
 * Everything above this file talks to `AvatarStorage`, so the upload service, the
 * media route and every test are free of SDK types and of network access. The
 * bucket is treated as private-read throughout: reads go through a short-lived
 * temporary URL minted here, fetched server-side, and never handed to a browser.
 *
 * Nothing in this module logs a key, a credential, a temporary URL or a response
 * body. Failures collapse to `AvatarStorageError` with a stable code, because
 * those codes travel into API envelopes and an SDK message can carry a bucket
 * path.
 *
 * @see https://docs.cloudbase.net/en/storage/sdk
 */

/**
 * A CloudBase fileID is `cloud://<env>/<object key>`. Delete and temporary-URL
 * both need the fileID, but the database's source of truth is the object key, so
 * a queued row whose fileID was never recorded can still be swept.
 */
function fileIdFor(config: AvatarStorageConfig, objectKey: string, known?: string | null): string {
  if (known && known.startsWith("cloud://")) return known;
  return `cloud://${config.envId}/${objectKey}`;
}

export function createCloudBaseAvatarStorage(config: AvatarStorageConfig): AvatarStorage {
  let app: CloudBase | undefined;

  /**
   * The SDK is imported lazily and cached. Loading it at module scope would drag
   * a network client into every route that merely imports the avatar service,
   * including the ones that only read metadata. The `init` lookup tolerates both
   * the named export and the CommonJS default interop shape.
   */
  async function client(): Promise<CloudBase> {
    if (app) return app;
    const loaded = await import("@cloudbase/node-sdk");
    const init = loaded.init ?? (loaded as unknown as { default?: { init?: typeof loaded.init } }).default?.init;
    if (typeof init !== "function") throw new AvatarStorageError("STORAGE_NOT_CONFIGURED");
    app = init({
      env: config.envId,
      secretId: config.secretId,
      secretKey: config.secretKey,
      ...(config.region ? { region: config.region } : {}),
    });
    return app;
  }

  const storage: AvatarStorage = {
    async put({ objectKey, body, contentType }) {
      try {
        const result = await (await client()).uploadFile({ cloudPath: objectKey, fileContent: Buffer.from(body) });
        if (!result?.fileID) throw new Error("missing fileID");
        // The served type follows the key's `.webp` extension; the pipeline
        // guarantees the bytes match it, so there is nothing else to negotiate.
        void contentType;
        return { fileId: result.fileID };
      } catch (error) {
        if (error instanceof AvatarStorageError) throw error;
        throw new AvatarStorageError("STORAGE_UPLOAD_FAILED");
      }
    },

    async remove({ objectKey, fileId }) {
      try {
        await (await client()).deleteFile({ fileList: [fileIdFor(config, objectKey, fileId)] });
      } catch (error) {
        if (error instanceof AvatarStorageError) throw error;
        // The delete queue retries and records attempts, so a transport or
        // permission failure surfaces as a code rather than a crash. CloudBase
        // treats a missing object as a success, so a replay does not land here.
        throw new AvatarStorageError("STORAGE_DELETE_FAILED");
      }
    },

    async temporaryUrl({ objectKey, fileId, ttlSeconds }) {
      try {
        const result = await (await client()).getTempFileURL({
          fileList: [{
            fileID: fileIdFor(config, objectKey, fileId),
            maxAge: ttlSeconds ?? AVATAR_TEMPORARY_URL_TTL_SECONDS,
          }],
        });
        const url = result?.fileList?.[0]?.tempFileURL;
        if (!url) throw new Error("missing tempFileURL");
        return url;
      } catch (error) {
        if (error instanceof AvatarStorageError) throw error;
        throw new AvatarStorageError("STORAGE_READ_FAILED");
      }
    },

    async read(input) {
      // Private-read path: mint a short-lived URL, fetch it here, return bytes.
      // The URL never leaves this function and is never logged.
      const url = await storage.temporaryUrl(input);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`status ${response.status}`);
        return {
          body: new Uint8Array(await response.arrayBuffer()),
          contentType: response.headers.get("content-type") ?? "image/webp",
        };
      } catch (error) {
        if (error instanceof AvatarStorageError) throw error;
        throw new AvatarStorageError("STORAGE_READ_FAILED");
      }
    },
  };

  return storage;
}
