import { formatPointsDelta } from "@/lib/points";

export type AccountTicket = {
  ticketId: string;
  matchId?: string;
  homeTeam: string;
  awayTeam: string;
  submittedAt: string;
  owner: { isCurrentUser: boolean };
  /** 1X2、比分或编码后的 F1 选择串；用 formatSelectionLabel 渲染。 */
  selection?: string;
  stakePoints?: string;
  confirmedOdds?: string;
  status: "FROZEN" | "WON" | "LOST" | "VOID";
  returnPoints?: string | null;
  netPoints?: string | null;
};

export function ownTickets(tickets: AccountTicket[]) {
  return tickets.filter((ticket) => ticket.owner.isCurrentUser);
}

export function accountTicketSummary(tickets: AccountTicket[]) {
  return tickets.reduce((summary, ticket) => {
    summary.total += 1;
    if (ticket.status === "FROZEN") summary.pending += 1;
    else summary.settled += 1;
    return summary;
  }, { total: 0, pending: 0, settled: 0 });
}

/** 缺值在流水语境里等于「没有变化」，所以兜底是 0 而不是破折号。 */
export function signedPoints(value: string | null | undefined) {
  return formatPointsDelta(value, "0");
}
