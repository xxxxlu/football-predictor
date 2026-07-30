import { describe, expect, it } from "vitest";
import {
  GRANTABLE_OPERATOR_ROLES,
  OPERATOR_CAPABILITIES,
  OPERATOR_ROLES,
  REAUTH_REQUIRED_CAPABILITIES,
  ROLE_CAPABILITIES,
  SUPER_ADMIN_COUNT,
  capabilitiesFor,
  hasCapability,
  isGrantableOperatorRole,
  operatorRolesOf,
  requiresReauthentication,
  type Capability,
} from "./capabilities.js";

describe("operator capability matrix", () => {
  it("keeps SUPER_ADMIN unique, out of reach of grants, and capped at two accounts", () => {
    expect(OPERATOR_ROLES).toContain("SUPER_ADMIN");
    expect(GRANTABLE_OPERATOR_ROLES).not.toContain("SUPER_ADMIN");
    expect(GRANTABLE_OPERATOR_ROLES).toEqual(["OPERATIONS_ADMIN", "COMMUNITY_MODERATOR"]);
    expect(isGrantableOperatorRole("SUPER_ADMIN")).toBe(false);
    for (const candidate of ["super_admin", "operations_admin", "OWNER", "", null, undefined, 1]) {
      expect(isGrantableOperatorRole(candidate)).toBe(false);
    }
    expect(SUPER_ADMIN_COUNT).toBe(2);
  });

  it("gives the super-admin every capability and each restricted duty a strict subset", () => {
    expect([...capabilitiesFor(["SUPER_ADMIN"])].sort()).toEqual([...OPERATOR_CAPABILITIES].sort());
    for (const role of GRANTABLE_OPERATOR_ROLES) {
      const capabilities = capabilitiesFor([role]);
      expect(capabilities.size).toBeGreaterThan(0);
      expect(capabilities.size).toBeLessThan(OPERATOR_CAPABILITIES.length);
      for (const capability of capabilities) expect(OPERATOR_CAPABILITIES).toContain(capability);
    }
    expect(capabilitiesFor([]).size).toBe(0);
  });

  it("scopes operations-admin to user security, room state and operational tasks", () => {
    expect([...capabilitiesFor(["OPERATIONS_ADMIN"])].sort()).toEqual([
      "OPERATIONS_HEALTH_READ",
      "OPERATIONS_TASK_RETRY",
      "ROOM_GOVERNANCE_READ",
      "ROOM_GOVERNANCE_WRITE",
      "ROOM_REPORT_READ",
      "USER_SECURITY_READ",
      "USER_SECURITY_WRITE",
    ]);
  });

  it("scopes community-moderator to report and chat governance only", () => {
    expect([...capabilitiesFor(["COMMUNITY_MODERATOR"])].sort()).toEqual([
      "COMMUNITY_GOVERNANCE_READ",
      "COMMUNITY_GOVERNANCE_WRITE",
      "ROOM_REPORT_READ",
    ]);
  });

  it("withholds credential, audit, audience, settlement and duty-administration reach from both restricted duties", () => {
    const offLimits: Capability[] = ["OPERATOR_ROLE_MANAGE", "AUDIT_READ", "AUDIENCE_ANALYTICS_READ", "COMPETITION_RESULT_ENTRY"];
    for (const role of GRANTABLE_OPERATOR_ROLES) {
      for (const capability of offLimits) expect(hasCapability([role], capability)).toBe(false);
    }
    for (const capability of offLimits) expect(hasCapability(["SUPER_ADMIN"], capability)).toBe(true);
  });

  it("never defines a capability that could touch a balance, a prediction or the ledger (FR59)", () => {
    // The list is closed on purpose: adding one of these would have to be an
    // explicit edit to capabilities.ts and would fail this test.
    for (const capability of OPERATOR_CAPABILITIES) {
      expect(capability).not.toMatch(/BALANCE|POINTS_WRITE|LEDGER|PREDICTION|TICKET_WRITE|SETTLEMENT_OVERRIDE|CREDENTIAL|PASSWORD|RECOVERY|SESSION_TOKEN/);
    }
  });

  it("requires re-authentication for every state-changing capability and for no read", () => {
    for (const capability of REAUTH_REQUIRED_CAPABILITIES) {
      expect(OPERATOR_CAPABILITIES).toContain(capability);
      expect(requiresReauthentication(capability)).toBe(true);
      expect(capability).not.toMatch(/_READ$/);
    }
    for (const capability of OPERATOR_CAPABILITIES.filter((entry) => entry.endsWith("_READ"))) {
      expect(requiresReauthentication(capability)).toBe(false);
    }
    const writes = OPERATOR_CAPABILITIES.filter((capability) => capability.endsWith("_WRITE") || capability.endsWith("_MANAGE") || capability.endsWith("_RETRY") || capability.endsWith("_ENTRY"));
    for (const capability of writes) expect(requiresReauthentication(capability)).toBe(true);
  });

  it("derives held roles from the seeded flag plus active grants", () => {
    expect(operatorRolesOf({ isSuperAdmin: true, operatorRoles: [] })).toEqual(["SUPER_ADMIN"]);
    expect(operatorRolesOf({ isSuperAdmin: false, operatorRoles: ["OPERATIONS_ADMIN"] })).toEqual(["OPERATIONS_ADMIN"]);
    expect(operatorRolesOf({ isSuperAdmin: false, operatorRoles: [] })).toEqual([]);
    expect(operatorRolesOf({ isSuperAdmin: false })).toEqual([]);
    // A super-admin who somehow also holds a grant keeps both, capabilities merge.
    expect(operatorRolesOf({ isSuperAdmin: true, operatorRoles: ["COMMUNITY_MODERATOR"] })).toEqual(["SUPER_ADMIN", "COMMUNITY_MODERATOR"]);
  });

  it("declares a capability list for every role with no unknown entries", () => {
    for (const role of OPERATOR_ROLES) {
      expect(ROLE_CAPABILITIES[role]).toBeDefined();
      for (const capability of ROLE_CAPABILITIES[role]) expect(OPERATOR_CAPABILITIES).toContain(capability);
    }
    expect(new Set(OPERATOR_CAPABILITIES).size).toBe(OPERATOR_CAPABILITIES.length);
  });
});
