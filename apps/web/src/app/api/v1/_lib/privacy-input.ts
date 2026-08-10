import { z } from "zod";

const browserBrandSchema = z.object({
  brand: z.string().max(128),
  version: z.string().max(64),
}).strict();

export const deviceInfoSchema = z.object({
  userAgent: z.string().max(1024).optional(),
  platform: z.string().max(128).optional(),
  language: z.string().max(64).optional(),
  languages: z.array(z.string().max(64)).max(10).optional(),
  screenWidth: z.number().int().positive().max(20000).optional(),
  screenHeight: z.number().int().positive().max(20000).optional(),
  availableScreenWidth: z.number().int().positive().max(20000).optional(),
  availableScreenHeight: z.number().int().positive().max(20000).optional(),
  viewportWidth: z.number().int().positive().max(20000).optional(),
  viewportHeight: z.number().int().positive().max(20000).optional(),
  colorDepth: z.number().int().positive().max(128).optional(),
  pixelRatio: z.number().positive().max(16).optional(),
  timezone: z.string().max(128).optional(),
  timezoneOffsetMinutes: z.number().int().min(-1440).max(1440).optional(),
  connectionType: z.string().max(64).optional(),
  networkType: z.string().max(64).optional(),
  downlinkMbps: z.number().nonnegative().max(100000).optional(),
  roundTripTimeMs: z.number().nonnegative().max(120000).optional(),
  saveData: z.boolean().optional(),
  deviceMemory: z.number().positive().max(1024).optional().nullable(),
  hardwareConcurrency: z.number().int().positive().max(1024).optional(),
  maxTouchPoints: z.number().int().nonnegative().max(100).optional(),
  cookieEnabled: z.boolean().optional(),
  doNotTrack: z.string().max(16).optional(),
  online: z.boolean().optional(),
  displayMode: z.string().max(32).optional(),
  orientationType: z.string().max(64).optional(),
  orientationAngle: z.number().int().min(-360).max(360).optional(),
  colorScheme: z.string().max(32).optional(),
  reducedMotion: z.boolean().optional(),
  contrast: z.string().max(32).optional(),
  navigationType: z.string().max(32).optional(),
  navigationDurationMs: z.number().nonnegative().max(3_600_000).optional(),
  userAgentData: z.object({
    brands: z.array(browserBrandSchema).max(10).optional(),
    mobile: z.boolean().optional(),
    platform: z.string().max(128).optional(),
    model: z.string().max(128).optional(),
    platformVersion: z.string().max(128).optional(),
  }).strict().optional(),
  batteryLevel: z.number().min(0).max(1).optional().nullable(),
  isCharging: z.boolean().optional(),
}).strict();

export const preferencesSchema = z.object({
  theme: z.string().max(32).optional(),
  locale: z.string().max(64).optional(),
  languages: z.array(z.string().max(64)).max(10).optional(),
  timezone: z.string().max(128).optional(),
  sportPreferences: z.array(z.string().max(64)).max(20).optional(),
  notificationEnabled: z.boolean().optional(),
  fontSize: z.string().max(32).optional(),
  colorScheme: z.string().max(32).optional(),
  reducedMotion: z.boolean().optional(),
  contrast: z.string().max(32).optional(),
  displayMode: z.string().max(32).optional(),
  privacyPolicyVersion: z.string().max(64).optional(),
}).strict();

export type DeviceInfoInput = z.infer<typeof deviceInfoSchema>;
export type PreferencesInput = z.infer<typeof preferencesSchema>;
