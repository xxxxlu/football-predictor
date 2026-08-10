"use client";
import { useState } from "react";
import { AVATAR_FALLBACK_TONES, avatarRenderPlan } from "@pulse/domain";

/**
 * The one avatar renderer (Story 12.6). Every surface that already shows a
 * nickname or a PULSE ID uses this, so the fallback, the sizing and the failure
 * behaviour cannot drift between the friend list, the lobby and the chats.
 *
 * Three properties it has to hold everywhere:
 *
 *  - **no layout shift.** The box is sized in both dimensions before the image
 *    exists, so a slow or missing avatar never reflows the row it sits in.
 *  - **always something to see.** No URL, or a URL that fails to load, both fall
 *    back to the member's initial on a deterministic tone. A broken-image glyph
 *    is never rendered.
 *  - **decorative, not duplicated.** The nickname is already next to the avatar
 *    on every surface, so the image is `alt=""` and aria-hidden by default; pass
 *    an explicit `alt` only where the avatar stands alone.
 */

export type AvatarSize = 24 | 32 | 36 | 40 | 56 | 96;

export interface AvatarProps {
  /** Same-origin media path, or null for an account with no avatar. */
  src?: string | null;
  /** Bumped on replacement; used to retry a previously failed load. */
  version?: number | null;
  nickname?: string | null;
  pulseId?: string | null;
  size?: AvatarSize;
  /** Set only when the avatar is not accompanied by a visible name. */
  alt?: string;
  /** Block lists and other de-emphasised rows. */
  muted?: boolean;
  className?: string;
}

/** Deterministic tones, so an account keeps its colour across every surface. */
const TONES: Array<{ background: string; color: string }> = [
  { background: "var(--panel-brand)", color: "var(--field)" },
  { background: "var(--wash-neutral)", color: "var(--ink)" },
  { background: "var(--panel-alert)", color: "var(--amber)" },
  { background: "var(--wash-brand)", color: "var(--field-dark)" },
  { background: "var(--wash-brand-soft)", color: "var(--coral)" },
  { background: "var(--wash-neutral-soft)", color: "var(--muted)" },
];

/** Initials scale with the box so a 24px chip and a 96px pass both stay legible. */
const FONT_SIZE: Record<AvatarSize, string> = {
  24: "0.625rem",
  32: "0.8125rem",
  36: "0.875rem",
  40: "1rem",
  56: "1.375rem",
  96: "2.25rem",
};

export function Avatar({ src, version, nickname, pulseId, size = 40, alt, muted = false, className = "" }: AvatarProps) {
  // The failure is remembered against the image it belongs to, not as a bare
  // boolean. A replacement is a different (src, version) pair, so it clears the
  // previous failure by simply not matching — no effect, no reset render, and no
  // window in which a fresh avatar is still showing the old one's fallback.
  const identity = `${src ?? ""}@${version ?? ""}`;
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null);

  const plan = avatarRenderPlan({ src, failed: failedIdentity === identity, nickname, pulseId, size });
  const tone = TONES[plan.tone % AVATAR_FALLBACK_TONES]!;
  const box = `${plan.box}px`;
  const decorative = alt === undefined;

  return (
    <span
      className={`pulse-avatar${muted ? " pulse-avatar--muted" : ""} ${className}`}
      style={{ width: box, height: box, minWidth: box, background: tone.background, color: tone.color }}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": alt })}
    >
      {plan.mode === "image"
        ? (
          // A plain <img>, deliberately: the source is a same-origin API route
          // that already serves a 512px WebP with immutable cache headers, so
          // next/image would only add a second hop and re-encode bytes that are
          // already sized and encoded.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src!}
            alt=""
            width={plan.box}
            height={plan.box}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailedIdentity(identity)}
          />
        )
        : <span aria-hidden="true" style={{ fontSize: FONT_SIZE[size] }}>{plan.initial}</span>}
    </span>
  );
}

/**
 * The friend-list variant: an avatar with the presence dot pinned to its
 * bottom-right corner, so the two never drift apart across surfaces.
 */
export function AvatarWithPresence({ online, ...props }: AvatarProps & { online: boolean }) {
  return (
    <span className="pulse-avatar-stack">
      <Avatar {...props} />
      <span className={`pulse-avatar-dot${online ? " pulse-avatar-dot--on" : ""}`} aria-hidden="true" />
    </span>
  );
}
