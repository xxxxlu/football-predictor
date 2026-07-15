export type AccountTicket = {
  ticketId: string;
  homeTeam: string;
  awayTeam: string;
  submittedAt: string;
  owner: { isCurrentUser: boolean };
  selection?: "HOME" | "DRAW" | "AWAY";
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

export function signedPoints(value: string | null | undefined) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "0.00";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}`;
}
