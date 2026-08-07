export function readCookie(header: string | null, name: string) {
  for (const pair of header?.split(";") ?? []) {
    const [key, ...parts] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function readSessionToken(request: Request) {
  return readCookie(request.headers.get("cookie"), "fp_session");
}

export function readReauthProof(request: Request) {
  return readCookie(request.headers.get("cookie"), "fp_reauth");
}
