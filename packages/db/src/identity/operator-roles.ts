import { capabilitiesFor, type Capability, type GrantableOperatorRole, type OperatorRole } from "@pulse/domain";
import type postgres from "postgres";

export interface OperatorAuthorization {
  isSuperAdmin: boolean;
  roles: OperatorRole[];
  capabilities: Capability[];
}

/** Pool or transaction handle — `ISql` is the base both `Sql` and `TransactionSql` extend. */
export type OperatorSql = postgres.ISql;

const DENIED: OperatorAuthorization = { isSuperAdmin: false, roles: [], capabilities: [] };

/**
 * Reads an account's live operator authorization straight from storage.
 *
 * Shared by every repository that has to authorize its own reads and writes
 * (defence in depth: the API layer checks the same capability first). Accepts a
 * transaction handle as well as a pool, so a write can resolve the actor inside
 * the very transaction that mutates state. A disabled or unknown account is
 * denied everything.
 */
export async function readOperatorAuthorization(sql: OperatorSql, userId: string): Promise<OperatorAuthorization> {
  const [row] = await sql<Array<{ isSuperAdmin: boolean; roles: GrantableOperatorRole[] | null }>>`
    SELECT u.is_super_admin AS "isSuperAdmin",
      (SELECT array_agg(g.role ORDER BY g.role) FROM identity.operator_role_grants g
        WHERE g.user_id = u.id AND g.revoked_at IS NULL) AS roles
    FROM identity.users u WHERE u.id = ${userId} AND u.status = 'ACTIVE' LIMIT 1`;
  if (!row) return DENIED;
  const roles: OperatorRole[] = [...(row.isSuperAdmin ? (["SUPER_ADMIN"] as const) : []), ...(row.roles ?? [])];
  return { isSuperAdmin: row.isSuperAdmin, roles, capabilities: [...capabilitiesFor(roles)] };
}

export async function hasOperatorCapability(sql: OperatorSql, userId: string, capability: Capability): Promise<boolean> {
  const authorization = await readOperatorAuthorization(sql, userId);
  return authorization.capabilities.includes(capability);
}
