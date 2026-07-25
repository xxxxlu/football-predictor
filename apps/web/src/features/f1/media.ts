/** Static lookup from entry-list identity (driver code / constructor key, see
 *  packages/domain/src/f1/season-2026.ts) to the locally hosted 2026 media assets
 *  under public/design-system/f1/. Files and their licensing provenance are
 *  recorded in public/design-system/f1/assets-manifest.json — every path below
 *  was checked against that manifest; do not guess new paths, extend the
 *  manifest first (scripts/sync-f1-media-assets.py). */

const DRIVER_PHOTO_SLUGS: Readonly<Record<string, string>> = {
  NOR: "mclarenlannor",
  PIA: "mclarenoscpia",
  RUS: "mercedesgeorus",
  ANT: "mercedesandant",
  VER: "redbullracingmaxver",
  HAD: "redbullracingisahad",
  LEC: "ferrarichalec",
  HAM: "ferrarilewham",
  SAI: "williamscarsai",
  ALB: "williamsalealb",
  LAW: "racingbullslialaw",
  LIN: "racingbullsarvlin",
  ALO: "astonmartinferalo",
  STR: "astonmartinlanstr",
  OCO: "haasf1teamestoco",
  BEA: "haasf1teamolibea",
  HUL: "audinichul",
  BOR: "audigabbor",
  GAS: "alpinepiegas",
  COL: "alpinefracol",
  PER: "cadillacserper",
  BOT: "cadillacvalbot",
};

const TEAM_ASSET_SLUGS: Readonly<Record<string, string>> = {
  mclaren: "mclaren",
  mercedes: "mercedes",
  "red-bull-racing": "redbullracing",
  ferrari: "ferrari",
  williams: "williams",
  "racing-bulls": "racingbulls",
  "aston-martin": "astonmartin",
  haas: "haasf1team",
  audi: "audi",
  alpine: "alpine",
  cadillac: "cadillac",
};

export function driverPhotoPath(code: string): string | null {
  const slug = DRIVER_PHOTO_SLUGS[code];
  return slug ? `/design-system/f1/drivers/2026${slug}01right.avif` : null;
}

/** White-on-transparent team logo — only legible on a dark (carbon) surface. */
export function teamLogoPath(constructorKey: string): string | null {
  const slug = TEAM_ASSET_SLUGS[constructorKey];
  return slug ? `/design-system/f1/motorcade-logo/2026${slug}logowhite.avif` : null;
}

export function teamCarPath(constructorKey: string): string | null {
  const slug = TEAM_ASSET_SLUGS[constructorKey];
  return slug ? `/design-system/f1/cars/2026${slug}carright.avif` : null;
}
