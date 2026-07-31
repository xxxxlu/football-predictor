import { describe, expect, it } from "vitest";
import { AuthError } from "../identity/service.js";
import { capabilitiesFor } from "../identity/capabilities.js";
import {
  assertMinimalReportContext,
  availableDispositions,
  canTransitionReport,
  dispositionCapability,
  DISPOSITION_NOTICE_KIND,
  isMuteActive,
  isMuteDuration,
  isTerminalReportStatus,
  KIND_DISPOSITIONS,
  muteExpiresAt,
  noticeAudience,
  parseGovernanceInboxQuery,
  REPORT_DISPOSITIONS,
  resolveInboxKinds,
  resolveInboxStatuses,
  visibleReportKinds,
} from "./inbox.js";

const superAdmin = capabilitiesFor(["SUPER_ADMIN"]);
const operationsAdmin = capabilitiesFor(["OPERATIONS_ADMIN"]);
const moderator = capabilitiesFor(["COMMUNITY_MODERATOR"]);
const member = capabilitiesFor([]);

describe("governance inbox scoping", () => {
  it("shows each duty only the report kind it is responsible for", () => {
    expect(visibleReportKinds(operationsAdmin)).toEqual(["ROOM"]);
    // 12.4: the channel is community surface — a moderator sees both message kinds.
    expect(visibleReportKinds(moderator)).toEqual(["MESSAGE", "CHANNEL_MESSAGE"]);
    expect(visibleReportKinds(superAdmin)).toEqual(["ROOM", "MESSAGE", "CHANNEL_MESSAGE"]);
    expect(visibleReportKinds(member)).toEqual([]);
  });

  it("refuses the inbox to an account with no report duty", () => {
    expect(() => resolveInboxKinds("ALL", member)).toThrow(AuthError);
    expect(() => resolveInboxKinds("ALL", member)).toThrowError(expect.objectContaining({ code: "FORBIDDEN", status: 403 }));
  });

  it("refuses a kind filter outside the operator's duty rather than returning an empty list", () => {
    // A moderator who filtered to room reports must learn they have no room duty,
    // not conclude that no room was ever reported.
    expect(() => resolveInboxKinds("ROOM", moderator)).toThrow(AuthError);
    expect(() => resolveInboxKinds("MESSAGE", operationsAdmin)).toThrow(AuthError);
    expect(() => resolveInboxKinds("CHANNEL_MESSAGE", operationsAdmin)).toThrow(AuthError);
    expect(resolveInboxKinds("MESSAGE", moderator)).toEqual(["MESSAGE"]);
    expect(resolveInboxKinds("CHANNEL_MESSAGE", moderator)).toEqual(["CHANNEL_MESSAGE"]);
    expect(resolveInboxKinds("ALL", operationsAdmin)).toEqual(["ROOM"]);
  });

  it("offers only the dispositions the operator's duty covers", () => {
    expect(availableDispositions("ROOM", operationsAdmin)).toEqual(["RESTRICT_ROOM", "CLOSE_ROOM", "RESTORE_ROOM", "DISMISS"]);
    expect(availableDispositions("MESSAGE", operationsAdmin)).toEqual([]);
    expect(availableDispositions("MESSAGE", moderator)).toEqual(["HIDE_MESSAGE", "RESTORE_MESSAGE", "MUTE_MEMBER", "DISMISS"]);
    expect(availableDispositions("CHANNEL_MESSAGE", moderator)).toEqual(["HIDE_MESSAGE", "RESTORE_MESSAGE", "MUTE_MEMBER", "DISMISS"]);
    expect(availableDispositions("CHANNEL_MESSAGE", operationsAdmin)).toEqual([]);
    expect(availableDispositions("ROOM", moderator)).toEqual([]);
  });

  it("prices every disposition at its kind's write capability and refuses a mismatched pair", () => {
    expect(dispositionCapability("ROOM", "CLOSE_ROOM")).toBe("ROOM_GOVERNANCE_WRITE");
    expect(dispositionCapability("MESSAGE", "MUTE_MEMBER")).toBe("COMMUNITY_GOVERNANCE_WRITE");
    expect(dispositionCapability("ROOM", "DISMISS")).toBe("ROOM_GOVERNANCE_WRITE");
    expect(dispositionCapability("MESSAGE", "DISMISS")).toBe("COMMUNITY_GOVERNANCE_WRITE");
    expect(dispositionCapability("CHANNEL_MESSAGE", "HIDE_MESSAGE")).toBe("COMMUNITY_GOVERNANCE_WRITE");
    expect(dispositionCapability("CHANNEL_MESSAGE", "DISMISS")).toBe("COMMUNITY_GOVERNANCE_WRITE");
    expect(() => dispositionCapability("ROOM", "HIDE_MESSAGE")).toThrow(AuthError);
    expect(() => dispositionCapability("MESSAGE", "CLOSE_ROOM")).toThrow(AuthError);
    expect(() => dispositionCapability("CHANNEL_MESSAGE", "RESTRICT_ROOM")).toThrow(AuthError);
  });

  it("covers every disposition with at least one kind — the message vocabulary serves both message kinds", () => {
    const assigned = new Set([...KIND_DISPOSITIONS.ROOM, ...KIND_DISPOSITIONS.MESSAGE, ...KIND_DISPOSITIONS.CHANNEL_MESSAGE]);
    for (const disposition of REPORT_DISPOSITIONS) expect(assigned).toContain(disposition);
    // 12.4: CHANNEL_MESSAGE reuses the MESSAGE vocabulary verbatim — no new disposition.
    expect(KIND_DISPOSITIONS.CHANNEL_MESSAGE).toEqual(KIND_DISPOSITIONS.MESSAGE);
    expect(assigned.size).toBe(REPORT_DISPOSITIONS.length);
  });
});

describe("report state machine", () => {
  it("allows triage and closure but never reopens a closed report", () => {
    expect(canTransitionReport("OPEN", "ASSIGNED")).toBe(true);
    expect(canTransitionReport("OPEN", "RESOLVED")).toBe(true);
    expect(canTransitionReport("ASSIGNED", "OPEN")).toBe(true);
    expect(canTransitionReport("ASSIGNED", "ASSIGNED")).toBe(true);
    expect(canTransitionReport("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionReport("DISMISSED", "ASSIGNED")).toBe(false);
    expect(canTransitionReport("RESOLVED", "DISMISSED")).toBe(false);
    expect(isTerminalReportStatus("RESOLVED")).toBe(true);
    expect(isTerminalReportStatus("OPEN")).toBe(false);
  });

  it("permits both self-loops, because triage does not change status", () => {
    // Changing severity leaves the status where it was, so an unclaimed report
    // stays OPEN. Without this edge, adjusting the severity of an unclaimed filing
    // — and releasing one that is already unassigned — was refused as an invalid
    // transition, which contradicts triage being available on any open report.
    expect(canTransitionReport("OPEN", "OPEN")).toBe(true);
    expect(canTransitionReport("ASSIGNED", "ASSIGNED")).toBe(true);
  });
});

describe("inbox filters", () => {
  it("defaults to the pending working set across every kind", () => {
    expect(parseGovernanceInboxQuery({})).toEqual({ kind: "ALL", status: "PENDING", severity: "ALL", assignee: "ALL", limit: 100 });
    expect(resolveInboxStatuses("PENDING")).toEqual(["OPEN", "ASSIGNED"]);
    expect(resolveInboxStatuses("ALL")).toEqual([]);
    expect(resolveInboxStatuses("RESOLVED")).toEqual(["RESOLVED"]);
  });

  it("refuses an unknown filter value instead of widening the read", () => {
    for (const raw of [{ kind: "EVERYTHING" }, { status: "PENDNIG" }, { severity: "URGENT" }, { assignee: "someone" }, { limit: "0" }, { limit: "201" }, { limit: "ten" }]) {
      expect(() => parseGovernanceInboxQuery(raw), JSON.stringify(raw)).toThrow(AuthError);
    }
  });

  it("keeps a valid narrowing intact", () => {
    expect(parseGovernanceInboxQuery({ kind: "MESSAGE", status: "OPEN", severity: "HIGH", assignee: "ME", limit: "25" }))
      .toEqual({ kind: "MESSAGE", status: "OPEN", severity: "HIGH", assignee: "ME", limit: 25 });
  });
});

describe("temporary mutes", () => {
  it("only accepts the published durations and caps them at a week", () => {
    expect(isMuteDuration(24)).toBe(true);
    expect(isMuteDuration(168)).toBe(true);
    expect(isMuteDuration(169)).toBe(false);
    expect(isMuteDuration(0)).toBe(false);
    expect(isMuteDuration(-1)).toBe(false);
    expect(isMuteDuration("24")).toBe(false);
    expect(isMuteDuration(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("expires on its own", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    expect(muteExpiresAt(now, 24).toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(isMuteActive(muteExpiresAt(now, 1), now)).toBe(true);
    expect(isMuteActive(new Date("2026-07-29T23:59:59.000Z"), now)).toBe(false);
    expect(isMuteActive(null, now)).toBe(false);
  });
});

describe("affected-user notices", () => {
  it("tells the subject and the reporter about a community sanction, and the owner about a room one", () => {
    expect(noticeAudience("MUTE_MEMBER")).toEqual(["SUBJECT", "REPORTER"]);
    expect(noticeAudience("HIDE_MESSAGE")).toEqual(["SUBJECT", "REPORTER"]);
    expect(noticeAudience("CLOSE_ROOM")).toEqual(["ROOM_OWNER", "REPORTER"]);
    expect(noticeAudience("DISMISS")).toEqual(["REPORTER"]);
  });

  it("gives every disposition a notice kind, so no outcome can land silently", () => {
    for (const disposition of REPORT_DISPOSITIONS) expect(DISPOSITION_NOTICE_KIND[disposition]).toBeTruthy();
    expect(noticeAudience("RESTORE_MESSAGE")).toContain("SUBJECT");
  });
});

describe("minimal disclosure", () => {
  const roomDetail = { kind: "ROOM" as const, room: { roomId: "r1", roomName: "周末德甲", roomStatus: "ACTIVE", memberCount: 6, openReportCount: 1 }, message: null, history: [] };
  const messageDetail = {
    kind: "MESSAGE" as const,
    room: null,
    message: { messageId: "m1", roomName: "周末德甲", author: "阿明", body: "被举报的一句话", sentAt: new Date(), hidden: false, mutedUntil: null },
    history: [],
  };

  const channelDetail = {
    kind: "CHANNEL_MESSAGE" as const,
    room: null,
    // A channel report reuses the message context shape; roomName carries the
    // explicit scope label, never a NULL room name (12.4).
    message: { messageId: "c1", roomName: "PULSE CLUB", author: "阿明", body: "被举报的频道发言", sentAt: new Date(), hidden: false, mutedUntil: null },
    history: [],
  };

  it("accepts the three intended shapes", () => {
    expect(() => assertMinimalReportContext(roomDetail)).not.toThrow();
    expect(() => assertMinimalReportContext(messageDetail)).not.toThrow();
    expect(() => assertMinimalReportContext(channelDetail)).not.toThrow();
  });

  it("refuses to hand a room report's chat content to a room moderator, or room context to a message moderator", () => {
    expect(() => assertMinimalReportContext({ ...roomDetail, message: messageDetail.message })).toThrow(/must not carry message content/);
    expect(() => assertMinimalReportContext({ ...messageDetail, room: roomDetail.room })).toThrow(/must not carry room governance context/);
  });

  it("refuses a message report that carries anything beyond the reported message", () => {
    expect(() => assertMinimalReportContext({ ...messageDetail, message: { ...messageDetail.message, roomId: "r1" } })).toThrow(/must not expose "roomId"/);
    expect(() => assertMinimalReportContext({ ...messageDetail, message: [messageDetail.message] })).toThrow(/exactly one reported message/);
    expect(() => assertMinimalReportContext({ ...messageDetail, message: null })).toThrow(/exactly one reported message/);
    // The channel kind is held to the same shape.
    expect(() => assertMinimalReportContext({ ...channelDetail, room: roomDetail.room })).toThrow(/must not carry room governance context/);
    expect(() => assertMinimalReportContext({ ...channelDetail, message: null })).toThrow(/exactly one reported message/);
  });

  it("refuses a browsable feed smuggled in as context", () => {
    expect(() => assertMinimalReportContext({ ...messageDetail, message: { ...messageDetail.message }, thread: [] } as never)).toThrow(/must not expose "thread"/);
    expect(() => assertMinimalReportContext({ ...roomDetail, room: { ...roomDetail.room, transcript: [] } } as never)).toThrow(/must not expose "transcript"/);
  });

  it("refuses a credential, a ledger figure or an unsealed pick at any depth", () => {
    expect(() => assertMinimalReportContext({ ...roomDetail, room: { ...roomDetail.room, passwordHash: "x" } } as never)).toThrow(/must not expose "passwordHash"/);
    expect(() => assertMinimalReportContext({ ...roomDetail, room: { ...roomDetail.room, balance: 100 } } as never)).toThrow(/must not expose "balance"/);
    expect(() => assertMinimalReportContext({ ...messageDetail, message: { ...messageDetail.message }, ipAddress: "1.2.3.4" } as never)).toThrow(/must not expose "ipAddress"/);
  });

  it("still allows a redacted audit trail through", () => {
    const history = [{ id: "a1", action: "REPORT_RESOLVED", actor: "运营", result: "SUCCESS", metadata: { reason: "违规", proof: "[REDACTED]" }, occurredAt: new Date() }];
    expect(() => assertMinimalReportContext({ ...roomDetail, history })).not.toThrow();
  });
});
