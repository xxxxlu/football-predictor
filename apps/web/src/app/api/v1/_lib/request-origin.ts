import { AuthError } from "@pulse/domain";
import { isSameOrigin as check } from "@pulse/guardrails";

/**
 * Same-origin guard for state-changing API requests.
 *
 * The comparison itself — and the reason it cannot be `new URL(request.url)` —
 * lives in `@pulse/guardrails`. Centralizing the call here keeps every mutation
 * endpoint on identical logic and gives the whole app one place to tighten.
 *
 * No `trustedHosts` yet, which means a forwarded host is believed. That is the
 * behaviour this app has always had and it is only safe because `SameSite=Lax`
 * carries the real load; the list is the upgrade, and it needs the deployment's
 * public hostnames to be configuration before it can be turned on.
 */
export function isSameOrigin(request: Request): boolean {
  return check(request);
}

export function assertSameOrigin(request: Request, action = "Reload this page and try again."): void {
  if (!isSameOrigin(request)) throw new AuthError("INVALID_ORIGIN", 403, action);
}
