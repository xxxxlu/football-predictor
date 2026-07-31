import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_GROUPS,
  DEFAULT_AUDIT_QUERY,
  HIGH_RISK_AUDIT_ACTIONS,
  auditActionGroup,
  isHighRiskAuditAction,
  parseAuditQuery,
  resolveAuditActions,
} from "./audit-query.js";

const uuid = "7f9c1b2e-4a5d-4c6f-8e9a-0b1c2d3e4f50";

describe("audit action vocabulary", () => {
  it("keeps every action in exactly one group", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const action of AUDIT_ACTIONS) expect(auditActionGroup(action)).not.toBeNull();
  });

  it("covers the actions the three audit writers actually persist", () => {
    // If a writer starts persisting a new action, this list has to grow with it —
    // otherwise the filter would refuse a value that exists in the trail.
    for (const action of [
      "OPERATOR_ROLE_GRANTED", "OPERATOR_ROLE_REVOKED", "ACCOUNT_DISABLED", "ACCOUNT_RESTORED",
      "SESSIONS_REVOKED", "ACCOUNT_ANONYMIZATION_REQUESTED", "ACCOUNT_ANONYMIZED",
      "ROOM_RESTRICT", "ROOM_CLOSE", "ROOM_RESTORE", "ROOM_PRE_MATCH_STAKE_VISIBILITY_UPDATED",
      "ROOM_REPORTED", "MESSAGE_REPORTED", "REPORT_TRIAGED", "REPORT_RESOLVED", "REPORT_DISMISSED",
      "MEMBER_UNMUTED", "ROOM_CREATED", "ROOM_JOINED", "INVITE_RESET", "JOB_RETRY_REQUESTED",
      // Story 12.3: member-side sanction companions + owner chat governance.
      "MEMBER_MUTED", "MESSAGE_HIDDEN", "MESSAGE_RESTORED", "MESSAGE_PINNED", "MESSAGE_UNPINNED",
    ]) expect(AUDIT_ACTIONS).toContain(action);
  });

  it("marks the irreversible decisions as high risk", () => {
    expect(isHighRiskAuditAction("OPERATOR_ROLE_GRANTED")).toBe(true);
    expect(isHighRiskAuditAction("ACCOUNT_ANONYMIZED")).toBe(true);
    // A mute ends participation for its window — the member-side twin of ROOM_CLOSE.
    expect(isHighRiskAuditAction("MEMBER_MUTED")).toBe(true);
    expect(isHighRiskAuditAction("ROOM_JOINED")).toBe(false);
    for (const action of HIGH_RISK_AUDIT_ACTIONS) expect(AUDIT_ACTIONS).toContain(action);
  });
});

describe("parseAuditQuery", () => {
  it("defaults to the whole trail", () => {
    expect(parseAuditQuery({})).toEqual(DEFAULT_AUDIT_QUERY);
  });

  it("accepts every documented filter", () => {
    const query = parseAuditQuery({
      actor: "  Ops_Admin  ", targetType: "USER", targetId: uuid.toUpperCase(), group: "ROLE",
      action: "OPERATOR_ROLE_GRANTED", result: "SUCCESS", from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-30T00:00:00.000Z", correlationId: uuid, limit: "50",
    });
    expect(query.actor).toBe("ops_admin");
    expect(query.targetId).toBe(uuid);
    expect(query.action).toBe("OPERATOR_ROLE_GRANTED");
    expect(query.from?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(query.limit).toBe(50);
  });

  it("strips characters a canonical username cannot contain", () => {
    expect(parseAuditQuery({ actor: "ops%_ad'min;--" }).actor).toBe("ops_admin");
  });

  it("refuses an actor fragment that nothing survives, rather than widening the trail", () => {
    // Every character was unusable, so there is no filter left. Returning the
    // whole platform trail would answer a question nobody asked.
    for (const actor of ["运营小李", "%%%", "'; --"]) {
      expect(() => parseAuditQuery({ actor })).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    }
    expect(parseAuditQuery({ actor: "   " }).actor).toBe("");
  });

  it("requires an instant with an explicit zone, so the window cannot depend on where the server runs", () => {
    for (const value of ["2026-07-30", "2026-7-1T00:00:00Z", "2026-07-30T00:00:00", "July 1 2026"]) {
      expect(() => parseAuditQuery({ from: value })).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    }
    expect(parseAuditQuery({ from: "2026-07-30T08:00:00+08:00" }).from?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("returns the page size the endpoint returned before it had filters", () => {
    // An operator who passes nothing must not silently get a shorter trail than
    // the unfiltered endpoint has always given them.
    expect(parseAuditQuery({}).limit).toBe(200);
  });

  it("refuses an unknown filter value rather than ignoring it", () => {
    for (const raw of [{ targetType: "LEDGER" }, { result: "MAYBE" }, { group: "BALANCE" }, { action: "LEDGER_ADJUSTED" }]) {
      expect(() => parseAuditQuery(raw)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    }
  });

  it("refuses an action that does not belong to the selected group", () => {
    expect(() => parseAuditQuery({ group: "ROLE", action: "ROOM_CLOSE" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    expect(parseAuditQuery({ group: "ROOM", action: "ROOM_CLOSE" }).action).toBe("ROOM_CLOSE");
  });

  it("refuses malformed identifiers and timestamps", () => {
    for (const raw of [{ targetId: "not-a-uuid" }, { correlationId: "42" }, { from: "yesterday" }, { limit: "-1" }, { limit: "9999" }]) {
      expect(() => parseAuditQuery(raw)).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    }
  });

  it("refuses an inverted time window", () => {
    expect(() => parseAuditQuery({ from: "2026-07-30T00:00:00Z", to: "2026-07-01T00:00:00Z" }))
      .toThrowError(expect.objectContaining({ code: "INVALID_REQUEST", status: 422 }));
    expect(parseAuditQuery({ from: "2026-07-01T00:00:00Z", to: "2026-07-01T00:00:00Z" }).to).toBeInstanceOf(Date);
  });
});

describe("resolveAuditActions", () => {
  it("returns no predicate for the unfiltered trail", () => {
    expect(resolveAuditActions({ group: "ALL", action: "" })).toEqual([]);
  });

  it("expands a group into its whole family", () => {
    const community = AUDIT_ACTION_GROUPS.find((entry) => entry.group === "COMMUNITY")!;
    expect(resolveAuditActions({ group: "COMMUNITY", action: "" })).toEqual([...community.actions]);
  });

  it("lets an exact action win over its group", () => {
    expect(resolveAuditActions({ group: "COMMUNITY", action: "REPORT_RESOLVED" })).toEqual(["REPORT_RESOLVED"]);
  });
});
