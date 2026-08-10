import { loadAvatarStorageConfig, loadIdentityConfig } from "@pulse/config";
import { createAvatarRepository, getSharedIdentityDatabase } from "@pulse/db";
import { AvatarStorageError, type AvatarStorage } from "@pulse/domain";
import { createAvatarService, type AvatarService } from "@/features/avatar/avatar-service";
import { createCloudBaseAvatarStorage } from "@/features/avatar/cloudbase-storage";
import { getIdentityService } from "../auth/_lib/runtime";
import { privacyRepository } from "./privacy-runtime";
import { createAvatarHandlers } from "./avatar-handlers";

declare global {
  var __pulseAvatarService: AvatarService | undefined;
}

/**
 * An environment without CloudBase credentials still boots and still serves every
 * other surface; the avatar endpoints answer AVATAR_UNAVAILABLE (503) instead.
 * Failing at import time would take the whole route table down with them.
 */
function unavailableStorage(): AvatarStorage {
  const refuse = async (): Promise<never> => {
    throw new AvatarStorageError("STORAGE_NOT_CONFIGURED");
  };
  return { put: refuse, remove: refuse, temporaryUrl: refuse, read: refuse };
}

export function avatarService(): AvatarService {
  if (!globalThis.__pulseAvatarService) {
    const config = loadIdentityConfig(process.env);
    const { sql } = getSharedIdentityDatabase(config.databaseUrl);
    const storageConfig = loadAvatarStorageConfig(process.env);
    globalThis.__pulseAvatarService = createAvatarService({
      repository: createAvatarRepository(sql),
      storage: storageConfig ? createCloudBaseAvatarStorage(storageConfig) : unavailableStorage(),
      privacy: privacyRepository(),
    });
  }
  return globalThis.__pulseAvatarService;
}

export function avatarHandlers() {
  return createAvatarHandlers(getIdentityService(), avatarService());
}
