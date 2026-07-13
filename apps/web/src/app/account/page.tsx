import type { Metadata } from "next";
import { AccountProfile } from "@/features/account/account-profile";
import { PrivateShell } from "@/features/matchday/private-shell";
export const metadata: Metadata = { title: "账户设置" };
export default function AccountPage() { return <PrivateShell title="账户设置" description="管理房间内显示的昵称和当前浏览器会话。"><AccountProfile/></PrivateShell>; }
