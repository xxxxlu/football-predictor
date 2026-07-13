import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";
import { loginHref, safeReturnTo } from "@/features/auth/navigation";

export const metadata: Metadata = { title: "注册" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ returnTo?: string | string[] }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo);
  return <AuthShell eyebrow="创建账户" title="从一张空白账本开始" description="无需手机号或邮箱。注册完成后会生成一个只展示一次的恢复码。" footer={<>已有账户？ <Link className="font-bold text-[var(--ink)] underline" href={loginHref(returnTo)}>直接登录</Link></>}><AuthForm mode="register" returnTo={returnTo}/></AuthShell>;
}
