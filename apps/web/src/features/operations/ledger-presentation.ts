export type SettlementFactInput = {
  outcome?: string | null;
  returnPoints?: string | null;
  netPoints?: string | null;
  settlementVersion?: string | null;
};

const outcomeLabels: Record<string, string> = { WIN: "命中", LOSS: "未命中", PUSH: "走盘退款", CANCEL: "取消退款" };

export function historySettlementFacts(ticket: SettlementFactInput) {
  if (!ticket.settlementVersion) return [];
  return [
    { label: "赛果", value: ticket.outcome ? outcomeLabels[ticket.outcome] ?? ticket.outcome : "—" },
    { label: "返还", value: ticket.returnPoints ?? "—" },
    { label: "净变化", value: ticket.netPoints ?? "—" },
    { label: "结算版本", value: ticket.settlementVersion },
  ];
}

export function correctionDebtExplanation(value: string) {
  return `当前更正债务 ${value} 分。这不是现金欠款，也不会要求充值；它仅记录赛果更正时已发积分无法全部冲回的差额，后续结算返还会优先自动抵扣。`;
}

export type LedgerReferenceInput = {
  roomId: string;
  ticketId?: string | null;
  settlementVersion?: string | null;
  auditId: string;
  reversesLedgerId?: string | null;
};

export function ledgerReferenceFacts(entry: LedgerReferenceInput): Array<[string, string]> {
  return [
    ["房间", entry.roomId],
    ...(entry.ticketId ? [["票号", entry.ticketId] as [string, string]] : []),
    ...(entry.settlementVersion ? [["结算版本", entry.settlementVersion] as [string, string]] : []),
    ["审计号", entry.auditId],
    ...(entry.reversesLedgerId ? [["冲正记录", entry.reversesLedgerId] as [string, string]] : []),
  ];
}
