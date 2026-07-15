import type { Metadata } from "next";
import { AccountActivityView } from "@/features/account/account-activity-view";
import { AccountProfile } from "@/features/account/account-profile";
import { PrivateShell } from "@/features/matchday/private-shell";
export const metadata: Metadata = { title: "我的账户" };
export default function AccountPage() { return <PrivateShell title="我的账户" description="查看每个房间的余额、判断与积分收支，并管理账户资料。"><div className="space-y-12"><AccountActivityView/><div><div className="mb-5 border-b rule pb-4"><p className="eyebrow">PROFILE & SESSION</p><h2 className="display mt-1 text-3xl font-bold">资料与安全</h2></div><AccountProfile/></div></div></PrivateShell>; }
