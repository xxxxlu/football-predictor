import type { MetadataRoute } from "next";

/** Single declaration of the installable icon set, consumed by both the PWA
 *  manifest and the document metadata so the two cannot drift apart.
 *
 *  The SVG marks are the source of truth; the PNGs are generated from them with
 *  `pnpm --filter @pulse/web generate:app-icons` and committed, because iOS
 *  ignores an SVG touch icon and several Android launchers skip an SVG-only
 *  manifest icon set. */

/** iOS home-screen icon. Without it, iOS substitutes a screenshot of the page. */
export const APPLE_TOUCH_ICON = "/apple-touch-icon.png";

export const MANIFEST_ICONS: MetadataRoute.Manifest["icons"] = [
  { src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/app-icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
  { src: "/app-icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
