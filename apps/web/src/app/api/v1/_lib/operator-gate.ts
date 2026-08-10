import { AuthError, type Capability } from "@pulse/domain";

/** The identity surface this gate needs: one resolve, capabilities included. */
export interface OperatorResolver {
  resolveOperator(sessionToken: string): Promise<{ account: { id: string }; capabilities: Capability[] }>;
}

/**
 * Admits a caller holding *any* of `candidates`, and says which one.
 *
 * Written as one resolve plus a set intersection rather than "do you hold X?"
 * asked once per candidate. The per-candidate form re-read the session from
 * storage on every question, so a single overview request could authenticate
 * five times over — and the operator whose one duty happened to sit last in the
 * list paid the most for it.
 *
 * The refusal semantics are deliberately unchanged: only *holding none of them*
 * is a FORBIDDEN. An expired session or a pending password change still
 * surfaces as itself, exactly as it did when a non-FORBIDDEN error broke the
 * loop instead of advancing it.
 *
 * Candidate order is preserved, so a caller that needs a concrete capability
 * afterwards (a re-auth-gated write) gets the same one the loop would have
 * settled on.
 */
export async function requireAnyCapability(
  identity: OperatorResolver,
  sessionToken: string,
  candidates: readonly Capability[],
): Promise<{ actorId: string; capability: Capability }> {
  const { account, capabilities } = await identity.resolveOperator(sessionToken);
  const held = candidates.find((candidate) => capabilities.includes(candidate));
  if (!held) throw new AuthError("FORBIDDEN", 403, "You do not have permission for this operation.");
  return { actorId: account.id, capability: held };
}
