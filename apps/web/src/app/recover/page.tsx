import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/features/auth/auth-form";
import { AuthShell } from "@/features/auth/auth-shell";
export const metadata: Metadata = { title: "恢复账户" };
export default function RecoverPage() { return <AuthShell eyebrow="账户恢复" title="换一把新钥匙" description="使用用户名和有效恢复码设置新密码。完成后旧恢复码和已有登录会话都会失效。" footer={<>想起密码了？ <Link className="font-bold text-[var(--ink)] underline" href="/login">返回登录</Link></>}><AuthForm mode="recover"/></AuthShell>; }
