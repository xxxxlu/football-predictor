/**
 * Same-origin check for state-changing requests, for apps behind a reverse proxy.
 *
 * The subtlety this exists for: comparing the browser's `Origin` against
 * `new URL(request.url).origin` looks obviously right and is wrong in deployment.
 * Next.js reports `request.url` with a `localhost` host even when the browser
 * addressed `127.0.0.1`, and any proxy that rewrites the host produces the same
 * mismatch — so the naive comparison rejects every legitimate same-origin write
 * in local development and behind load balancers. The origin the browser actually
 * addressed has to be reconstructed from the forwarding headers instead.
 *
 * Those headers are attacker-supplied in the general case. `trustedHosts` is how
 * a caller says which values are real; without it the check trusts the hop in
 * front of it, which is only safe when something upstream is guaranteed to
 * overwrite `x-forwarded-host`. Pass the list in production.
 */

export interface SameOriginOptions {
  /**
   * Hosts (`example.com` or `example.com:8443`) the forwarding headers may name.
   * When omitted, any forwarded host is believed — appropriate only where a proxy
   * is known to set these headers itself and strip inbound copies.
   */
  trustedHosts?: readonly string[];
  /**
   * How to treat a request with no `Origin` header at all. `"same-origin"` (the
   * default) matches the browser reality that cross-site `fetch` and form posts
   * always send one, so a missing header means a same-origin navigation or a
   * non-browser client. `"reject"` is the stricter reading for an API that only
   * ever serves browsers.
   */
  missingOrigin?: "same-origin" | "reject";
}

export function isSameOrigin(request: Request, options: SameOriginOptions = {}): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return options.missingOrigin !== "reject";

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  // An off-list forwarded host fails outright rather than falling through to
  // `Host`: silently ignoring the proxy's own rewrite would let a caller choose
  // which host the comparison runs against, which is the thing the list is for.
  if (forwardedHost && options.trustedHosts && !options.trustedHosts.includes(forwardedHost)) {
    return false;
  }

  const host = forwardedHost || request.headers.get("host");
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProtocol || requestUrl.protocol.slice(0, -1);
  // No host header at all — a synthesized `Request`, or a client that omitted it.
  // The request URL is then the only statement of where this was addressed, and
  // it is the server's own, so it is the safe thing to compare against.
  const expected = host ? `${protocol}://${host}` : requestUrl.origin;
  return origin === expected;
}
