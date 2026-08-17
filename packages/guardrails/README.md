# @pulse/guardrails

Four dependency-free primitives for things that are easy to get subtly wrong.
Each was written to fix a real failure in a production app, and each carries the
reasoning in the source — because in every case the naive version looks correct.

No runtime dependencies. Node 20+.

## `multiplyByDecimal(integer, decimalString)`

Exact multiplication of an integer by a decimal written as a string, rounded half
up exactly once.

```ts
multiplyByDecimal(1000, "2.1"); // 2100      — Number(1000 * 2.1) is 2100.0000000000002
multiplyByDecimal(3, "1.005");  // 3         — Number(3 * 1.005) is 3.0149999999999997
```

Use it wherever a quantity is multiplied by a rate and the result is money,
points, or anything that has to reconcile. Binary floating point cannot represent
most decimal fractions, so the obvious `Math.round(n * Number(rate))` is not a
rounding artefact away from correct — it is wrong in a way that accumulates.
Everything here stays in `BigInt` until the final step.

Throws `DecimalError` rather than returning a wrong number: a malformed rate, a
negative or non-integer multiplicand, and a product past `Number.MAX_SAFE_INTEGER`
are all conditions where continuing silently is worse than refusing.

## `isSameOrigin(request, options?)`

Same-origin check for state-changing requests, for apps behind a reverse proxy.

```ts
if (!isSameOrigin(request, { trustedHosts: ["app.example.com"] })) return refuse();
```

The subtlety it exists for: comparing `Origin` against `new URL(request.url).origin`
looks obviously right and fails in deployment. Next.js reports `request.url` with
a `localhost` host even when the browser addressed `127.0.0.1`, and any proxy that
rewrites the host produces the same mismatch — so the naive comparison rejects
every legitimate same-origin write locally and behind load balancers.

Pass `trustedHosts` in production. Without it a forwarded host is believed, which
is only safe where a proxy is guaranteed to set those headers itself and strip
inbound copies. `missingOrigin: "reject"` is the stricter reading for an API that
only ever serves browsers.

## `createKeyRedactor(options)`

Redacts a structure by key name, for metadata that ends up somewhere a person
reads it — an audit trail, a support console, a log line.

```ts
const redact = createKeyRedactor({
  substrings: ["token", "password", "secret"],
  words: ["ip", "lat", "lng"],
});
redact({ refreshToken: "…", reporterIpAddress: "…", description: "ships in a zip" });
// { refreshToken: "[REDACTED]", reporterIpAddress: "[REDACTED]", description: "ships in a zip" }
```

It matches on the key, never the value, because the writer is what you cannot
trust to be careful — a rule keyed on value shape has to guess what a token looks
like, while a rule keyed on name holds whatever a future caller stuffs into
`recoveryCode`.

The two matching modes are the point. `substrings` suits secret-ish words, which
compound freely (`apiKey`, `passwordHash`). `words` matches only a whole
underscore-delimited word after snake_case normalisation, which is what short
words need: `ip` sits inside `description` and `recipient`, and redacting an
operator's own written reason is a worse outcome than the leak it was guarding
against.

## `createCapabilityModel({ roleCapabilities, reauthRequired })`

Capability-based authorization: the mechanism, with the policy left to you.

```ts
const model = createCapabilityModel({
  roleCapabilities: { ADMIN: ["READ", "PURGE"], MOD: ["READ"] },
  reauthRequired: ["PURGE"],
});
model.hasCapability(rolesFromStorage, "PURGE");
```

Roles are what an account *is*; capabilities are what it may *do*. Everything
downstream asks about a capability, so moving a duty between roles is one edit to
a table instead of a search for every `if (isAdmin)`.

Two properties worth keeping: resolve from roles you just read from storage rather
than roles cached in a session, or a revoked duty keeps working until the session
expires; and keep the capability list closed, because its value is that
"there is no capability that edits a balance" becomes a fact you check by reading
one file instead of auditing a system.
