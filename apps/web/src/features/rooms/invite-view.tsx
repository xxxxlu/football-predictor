"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { inviteJoinRequest } from "./room-flow";

type InvitePreview = { id: string; name: string };

export function InviteView({ token }: { token: string }) {
  const router = useRouter();
  const rulesId = useId();
  const [preview, setPreview] = useState<InvitePreview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [loginRequired, setLoginRequired] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/v1/rooms/invites/${encodeURIComponent(token)}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json().catch(() => ({})) as ApiEnvelope<InvitePreview> & ApiFailure;
        if (!response.ok) throw new Error(inviteError(result.error?.code, result.error?.message));
        setPreview(result.data);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError((reason as Error).message || "邀请不可用");
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [token]);

  async function join() {
    if (!accepted) return;
    setJoining(true); setJoinError(""); setLoginRequired(false);
    const request = inviteJoinRequest(token);
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<{ roomId: string; joined: boolean }> & ApiFailure;
      if (response.status === 401) { setLoginRequired(true); return; }
      if (!response.ok) throw new Error(inviteError(result.error?.code, result.error?.message));
      router.push(`/rooms/${encodeURIComponent(result.data.roomId)}`);
      router.refresh();
    } catch (reason) {
      setJoinError((reason as Error).message || "暂时无法加入房间");
    } finally {
      setJoining(false);
    }
  }

  return <div className="min-h-screen"><header className="field-accent border-b rule bg-[rgb(244_240_230/85%)] backdrop-blur"><div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4 sm:px-8"><BrandMark/><Link href="/rooms" className="text-sm font-bold underline">我的房间</Link></div></header><main id="main-content" className="mx-auto max-w-3xl px-4 py-10 sm:px-8 sm:py-16">
    {loading ? <DataStatePanel state="loading" title="正在检查邀请" description=""/> : error || !preview ? <DataStatePanel state="error" title="这条邀请无法使用" description={error || "请联系房主获取新的邀请链接。"} action={<Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold no-underline transition hover:bg-[var(--ink)] hover:text-white">返回首页</Link>}/> : <section className="surface mx-auto max-w-xl p-6 sm:p-8"><p className="eyebrow">私人房间邀请</p><h1 className="display mt-2 text-4xl font-bold">加入「{preview.name}」</h1><p className="mt-4 leading-7 text-[var(--muted)]">加入后会建立独立积分账户，并且仅首次获得 10,000 初始积分。重复打开邀请不会重复发分。</p>{joinError && <div className="mt-5"><StatusMessage tone="error" title="未能加入">{joinError}</StatusMessage></div>}{loginRequired && <div className="mt-5"><StatusMessage tone="info" title="请先登录">登录完成后使用浏览器返回此邀请页，再确认加入。</StatusMessage><Link href="/login" className="mt-3 flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-center font-bold no-underline transition hover:bg-[var(--ink)] hover:text-white">前往登录</Link></div>}<label htmlFor={rulesId} className="mt-6 flex cursor-pointer items-start gap-3 border-t rule pt-5 text-sm leading-6"><input id={rulesId} type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--field)]"/><span>我确认年满 18 岁并接受当前私人房间规则；虚拟积分不可充值、转让、提现或兑换。 <Link href="/terms" className="font-bold underline">查看完整规则</Link></span></label><button type="button" onClick={join} disabled={!accepted || joining} className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45">{joining ? "正在确认成员资格…" : "确认规则并加入房间"}</button><p className="mt-3 text-xs leading-5 text-[var(--muted)]">若你已经是成员，本操作会直接返回原房间，不会重复创建账户或积分。</p></section>}
  </main><footer className="night border-t border-[var(--night-line)] px-4 py-8 text-center text-xs text-white/50">虚拟积分不可充值、提现或兑换 · 仅限 18+</footer></div>;
}

function inviteError(code?: string, fallback?: string) {
  if (code === "INVITE_INVALID") return "邀请已失效。请联系房主获取新的链接。";
  if (code === "ROOM_RULES_REQUIRED") return "请确认当前私人房间规则。";
  return fallback || "邀请暂时不可用，请稍后重试。";
}
