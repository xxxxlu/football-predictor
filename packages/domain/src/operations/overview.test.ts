import { describe, expect, it } from "vitest";
import { ROLE_CAPABILITIES } from "../identity/capabilities.js";
import {
  OVERVIEW_CARDS,
  OVERVIEW_CARD_ACTION,
  OVERVIEW_CARD_CAPABILITY,
  accountRiskSeverity,
  jobSeverity,
  overallSeverity,
  overviewNextStep,
  reportQueueSeverity,
  settlementSeverity,
  supplierSeverity,
  visibleOverviewCards,
} from "./overview.js";

const superAdmin = ROLE_CAPABILITIES.SUPER_ADMIN;
const operations = ROLE_CAPABILITIES.OPERATIONS_ADMIN;
const moderator = ROLE_CAPABILITIES.COMMUNITY_MODERATOR;

describe("operations overview assembly", () => {
  it("shows a super-admin every card", () => {
    expect(visibleOverviewCards(superAdmin)).toEqual([...OVERVIEW_CARDS]);
  });

  it("hides the role-change card from an operations admin", () => {
    const cards = visibleOverviewCards(operations);
    expect(cards).toContain("JOB_HEALTH");
    expect(cards).toContain("ACCOUNT_RISK");
    expect(cards).not.toContain("ROLE_CHANGES");
  });

  it("gives a community moderator the report queue and nothing else", () => {
    expect(visibleOverviewCards(moderator)).toEqual(["REPORT_QUEUE"]);
  });

  it("gives a member with no duties no cards at all", () => {
    expect(visibleOverviewCards([])).toEqual([]);
  });

  it("keeps every card gated on a capability that exists in the matrix", () => {
    for (const card of OVERVIEW_CARDS) expect(superAdmin).toContain(OVERVIEW_CARD_CAPABILITY[card]);
  });

  it("withholds a card's next step when the operator cannot perform it", () => {
    // An operations admin may read job health; only they may retry, and a
    // moderator who could somehow see the card still gets no button.
    expect(overviewNextStep("JOB_HEALTH", operations)?.capability).toBe("OPERATIONS_TASK_RETRY");
    expect(overviewNextStep("JOB_HEALTH", moderator)).toBeNull();
    expect(overviewNextStep("ROLE_CHANGES", operations)).toBeNull();
    expect(overviewNextStep("ROLE_CHANGES", superAdmin)?.href).toBe("/admin/operators");
  });

  it("offers no next step for the read-only health cards", () => {
    expect(OVERVIEW_CARD_ACTION.SUPPLIER_HEALTH).toBeNull();
    expect(overviewNextStep("SETTLEMENT_HEALTH", superAdmin)).toBeNull();
  });

  it("never routes a next step to a write the capability matrix withholds", () => {
    // Guards against a future card offering a balance, prediction or ledger
    // action: FR59 keeps those out of every role, so no action may name one.
    const forbidden = ["BALANCE", "LEDGER", "PREDICTION", "SETTLEMENT_WRITE"];
    for (const card of OVERVIEW_CARDS) {
      const action = OVERVIEW_CARD_ACTION[card];
      if (!action) continue;
      expect(superAdmin).toContain(action.capability);
      for (const word of forbidden) expect(action.capability).not.toContain(word);
    }
  });
});

describe("overview severity", () => {
  it("takes the worst of what the operator can see", () => {
    expect(overallSeverity(["OK", "WATCH", "ACT"])).toBe("ACT");
    expect(overallSeverity(["OK", "WATCH"])).toBe("WATCH");
    expect(overallSeverity([])).toBe("OK");
  });

  it("treats an exhausted supplier budget or unavailable data as needing action", () => {
    expect(supplierSeverity({ generalRemaining: 0, staleMatches: 0, unavailableMatches: 0 })).toBe("ACT");
    expect(supplierSeverity({ generalRemaining: 80, staleMatches: 0, unavailableMatches: 2 })).toBe("ACT");
    expect(supplierSeverity({ generalRemaining: 8, staleMatches: 0, unavailableMatches: 0 })).toBe("WATCH");
    expect(supplierSeverity({ generalRemaining: 80, staleMatches: 3, unavailableMatches: 0 })).toBe("WATCH");
    expect(supplierSeverity({ generalRemaining: 80, staleMatches: 0, unavailableMatches: 0 })).toBe("OK");
  });

  it("escalates failed and overdue settlements over merely pending ones", () => {
    expect(settlementSeverity({ failed: 1, pending: 0, overdueSettlements: 0 })).toBe("ACT");
    expect(settlementSeverity({ failed: 0, pending: 0, overdueSettlements: 2 })).toBe("ACT");
    expect(settlementSeverity({ failed: 0, pending: 4, overdueSettlements: 0 })).toBe("WATCH");
    expect(settlementSeverity({ failed: 0, pending: 0, overdueSettlements: 0 })).toBe("OK");
  });

  it("raises a failed job immediately and watches a lagging queue", () => {
    expect(jobSeverity({ failed: 1, maxLagSeconds: 0 })).toBe("ACT");
    expect(jobSeverity({ failed: 0, maxLagSeconds: 301 })).toBe("WATCH");
    expect(jobSeverity({ failed: 0, maxLagSeconds: 300 })).toBe("OK");
  });

  it("treats an unclaimed report as the thing that needs a person", () => {
    expect(reportQueueSeverity({ unassigned: 1, pending: 1 })).toBe("ACT");
    expect(reportQueueSeverity({ unassigned: 0, pending: 3 })).toBe("WATCH");
    expect(reportQueueSeverity({ unassigned: 0, pending: 0 })).toBe("OK");
  });

  it("leads account risk with the overdue anonymization service level", () => {
    expect(accountRiskSeverity({ overdueAnonymizations: 1, openAnonymizations: 1, disabledAccounts: 0, restrictedRoomOwners: 0 })).toBe("ACT");
    expect(accountRiskSeverity({ overdueAnonymizations: 0, openAnonymizations: 1, disabledAccounts: 0, restrictedRoomOwners: 0 })).toBe("WATCH");
    expect(accountRiskSeverity({ overdueAnonymizations: 0, openAnonymizations: 0, disabledAccounts: 2, restrictedRoomOwners: 0 })).toBe("WATCH");
    expect(accountRiskSeverity({ overdueAnonymizations: 0, openAnonymizations: 0, disabledAccounts: 0, restrictedRoomOwners: 1 })).toBe("WATCH");
    expect(accountRiskSeverity({ overdueAnonymizations: 0, openAnonymizations: 0, disabledAccounts: 0, restrictedRoomOwners: 0 })).toBe("OK");
  });
});
