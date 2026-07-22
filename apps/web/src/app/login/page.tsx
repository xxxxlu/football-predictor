import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";
import { safeReturnTo } from "@/features/auth/navigation";

export const metadata: Metadata = { title: "登录" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo);
  const query = `?returnTo=${encodeURIComponent(returnTo)}`;
  return <AuthShell eyebrow="欢迎回来" title="继续你的赛事" description="登录后回到私人房间，查看判断、积分和账本。" footer={<>还没有账户？ <Link className="font-bold text-[var(--ink)] underline" href={`/register${query}`}>免费注册</Link> · <Link className="font-bold text-[var(--ink)] underline" href={`/recover${query}`}>使用恢复码</Link></>}><AuthForm mode="login" returnTo={returnTo}/></AuthShell>;
}
