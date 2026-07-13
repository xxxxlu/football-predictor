import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { LedgerView } from "@/features/operations/ledger-view";
export const metadata: Metadata = { title: "积分账本" };
export default function LedgerPage() { return <PrivateShell title="积分账本" description="解释每一次发放、冻结、结算、冲正和债务抵扣。"><LedgerView/></PrivateShell>; }
