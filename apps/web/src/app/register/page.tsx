import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";
export const metadata: Metadata = { title: "注册" };
export default function RegisterPage() { return <AuthShell eyebrow="创建账户" title="从一张空白账本开始" description="无需手机号或邮箱。注册完成后会生成一个只展示一次的恢复码。" footer={<>已有账户？ <Link className="font-bold text-[var(--ink)] underline" href="/login">直接登录</Link></>}><AuthForm mode="register"/></AuthShell>; }
