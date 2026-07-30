import type { Metadata } from "next";
import { PrivateShell } from "@/features/matchday/private-shell";
import { AdminOperatorsView } from "@/features/operations/admin-operators-view";
export const metadata: Metadata = { title: "运营职责" };
export default function AdminOperatorsPage() { return <PrivateShell title="运营职责" description="只有超级管理员可以授予或撤销受限的运营与社区职责；变更前必须重新确认身份。"><AdminOperatorsView/></PrivateShell>; }
