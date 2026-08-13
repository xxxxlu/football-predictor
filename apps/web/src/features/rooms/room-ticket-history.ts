import { formatOdds, formatPoints, formatPointsDelta } from "@/lib/points";
import { formatSelectionLabel } from "../matchday/selection-label";

export type TicketStatus = "FROZEN" | "WON" | "LOST" | "VOID";
/**
 * What a hidden ticket may say about itself: the round's stage, never its result.
 * `SETTLED` stands in for WON/LOST/VOID so a member cannot read another member's
 * outcome off the badge while `postMatchTicketVisible` is off.
 */
export type HiddenTicketStatus = "FROZEN" | "SETTLED";
export type AnyTicketStatus = TicketStatus | HiddenTicketStatus;

type TicketBase = {
  ticketId: string; matchId: string; homeTeam: string; awayTeam: string; kickoffAt: string; submitted: true;
  owner: { userId: string; displayName: string; isCurrentUser: boolean };
};
type PrivateTicket = TicketBase & { visibility: "PRIVATE"; status: HiddenTicketStatus };
type StakeOnlyTicket = TicketBase & { visibility: "STAKE_ONLY"; status: TicketStatus; submittedAt: string; stakePoints: string };
type RevealedTicket = TicketBase & {
  visibility: "REVEALED"; status: TicketStatus; submittedAt: string; stakePoints: string; selection: string; confirmedOdds: string;
  outcome: string | null; returnPoints: string | null; netPoints: string | null; settlementVersion: string | null;
};
export type TicketHistoryRecord = PrivateTicket | StakeOnlyTicket | RevealedTicket;

export function toTicketHistoryView(record: TicketHistoryRecord) {
  const base = {
    ...record,
    ownerLabel: record.owner.isCurrentUser ? "我的记录" : record.owner.displayName,
    disclosure: record.visibility === "REVEALED" ? "完整记录" : record.visibility === "STAKE_ONLY" ? "已公开投入" : "已提交，详情未公开",
    submittedAt: "submittedAt" in record ? record.submittedAt : null,
    stake: "stakePoints" in record ? formatPoints(record.stakePoints) : null,
    selection: record.visibility === "REVEALED" ? formatSelectionLabel(record.selection) : null,
    odds: record.visibility === "REVEALED" ? formatOdds(record.confirmedOdds) : null,
    returnPoints: record.visibility === "REVEALED" ? formatPoints(record.returnPoints, "") || null : null,
    // 净积分是变化值，§7.3 要求带正负号；未结算时保持 null，由视图层显示「未公开」。
    netPoints: record.visibility === "REVEALED" && record.netPoints !== null ? formatPointsDelta(record.netPoints) : null,
  };
  return base;
}
