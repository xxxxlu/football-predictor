const DEFAULT_RETURN_TO = "/rooms";

export function safeReturnTo(target: string | null | undefined, fallback = DEFAULT_RETURN_TO) {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback;
  try {
    const decoded = decodeURIComponent(target);
    if (decoded.startsWith("//") || decoded.includes("\\")) return fallback;
    const parsed = new URL(target, "https://football-predictor.local");
    if (parsed.origin !== "https://football-predictor.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function loginHref(returnTo: string | null | undefined) {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}

export const recoveryReceiptContinueHref = loginHref;
