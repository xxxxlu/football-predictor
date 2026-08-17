/**
 * Capability-based authorization: the mechanism, with the policy left to the
 * caller.
 *
 * Roles are what an account *is*; capabilities are what it may *do*. Everything
 * downstream asks about a capability, never about a role — so adding a role, or
 * moving a duty between roles, is one edit to a table instead of a search for
 * every `if (isAdmin)` in the codebase.
 *
 * Two properties worth keeping when you use this:
 *
 *  - **Resolve per request.** Hand `capabilitiesFor` the roles you just read from
 *    storage, not roles cached in a session, or a revoked duty keeps working
 *    until the session expires.
 *  - **Keep the capability list closed.** Its value is that you can read it and
 *    know the ceiling. A capability that does not exist cannot be granted by
 *    accident, which is why "there is no capability that edits a balance" is a
 *    fact you can check by reading one file rather than auditing a system.
 *
 * `reauthRequired` marks the capabilities whose exercise should additionally
 * demand a fresh proof of identity. This model reports the requirement; enforcing
 * it belongs with whatever issues and verifies the proof.
 */

export interface CapabilityModel<Role extends string, Capability extends string> {
  /** Every capability the given roles add up to. */
  capabilitiesFor(roles: readonly Role[]): Set<Capability>;
  /** Whether the given roles include one that carries this capability. */
  hasCapability(roles: readonly Role[], capability: Capability): boolean;
  /** Whether exercising this capability should demand a fresh identity proof. */
  requiresReauthentication(capability: Capability): boolean;
}

export function createCapabilityModel<Role extends string, Capability extends string>(input: {
  roleCapabilities: Readonly<Record<Role, readonly Capability[]>>;
  reauthRequired?: readonly Capability[];
}): CapabilityModel<Role, Capability> {
  const reauth = new Set<Capability>(input.reauthRequired ?? []);
  // Precomputed so a lookup is a set probe rather than a scan of every role's
  // list; the tables are small, but this runs on every authorized request.
  const byRole = new Map<Role, ReadonlySet<Capability>>(
    (Object.keys(input.roleCapabilities) as Role[]).map((role) => [
      role,
      new Set(input.roleCapabilities[role]),
    ]),
  );

  return {
    capabilitiesFor(roles) {
      const capabilities = new Set<Capability>();
      for (const role of roles) {
        for (const capability of byRole.get(role) ?? []) capabilities.add(capability);
      }
      return capabilities;
    },
    hasCapability(roles, capability) {
      return roles.some((role) => byRole.get(role)?.has(capability) ?? false);
    },
    requiresReauthentication(capability) {
      return reauth.has(capability);
    },
  };
}
