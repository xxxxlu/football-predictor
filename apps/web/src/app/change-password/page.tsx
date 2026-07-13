import type { Metadata } from "next";
import { AuthShell } from "@/features/auth/auth-shell";
import { ChangePasswordForm } from "@/features/auth/change-password-form";
export const metadata: Metadata = { title: "修改初始密码" };
export default function ChangePasswordPage() { return <AuthShell eyebrow="安全步骤" title="修改初始密码" description="预置超级管理员首次登录必须更换初始密码。完成前不能进入管理功能。" footer={<>密码更新后，所有旧会话会立即失效，并为当前浏览器签发新会话。</>}><ChangePasswordForm/></AuthShell>; }
