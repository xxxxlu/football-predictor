import { AuthError } from "@pulse/domain";

/**
 * Same-origin guard for state-changing API requests.
 *
 * Compares the browser `Origin` header against the origin the browser actually
 * addressed — derived from the `Host` header (honoring a trusted
 * `x-forwarded-host` / `x-forwarded-proto` pair when behind a reverse proxy) —
 * rather than Next's canonical `request.url`. Next reports `request.url` with a
 * `localhost` host even when the browser used `127.0.0.1`, so comparing against
 * `new URL(request.url).origin` rejects every legitimate same-origin write in
 * local development and behind proxies that rewrite the host. Centralizing the
 * check keeps every mutation endpoint on identical logic.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
  const expectedOrigin = host ? `${protocol}://${host}` : requestUrl.origin;
  return origin === expectedOrigin;
}

export function assertSameOrigin(request: Request, action = "Reload this page and try again."): void {
  if (!isSameOrigin(request)) throw new AuthError("INVALID_ORIGIN", 403, action);
}
