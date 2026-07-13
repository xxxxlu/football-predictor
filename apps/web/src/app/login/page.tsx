import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";
export const metadata: Metadata = { title: "登录" };
export default function LoginPage() { return <AuthShell eyebrow="欢迎回来" title="继续你的比赛日" description="登录后回到私人房间，查看判断、积分和账本。" footer={<>还没有账户？ <Link className="font-bold text-[var(--ink)] underline" href="/register">免费注册</Link> · <Link className="font-bold text-[var(--ink)] underline" href="/recover">使用恢复码</Link></>}><AuthForm mode="login"/></AuthShell>; }
