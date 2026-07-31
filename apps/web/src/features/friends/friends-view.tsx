"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import {
  friendErrorMessage,
  FRIENDS_POLL_INTERVAL_MS,
  normalizePulseIdInput,
  requestOutcomeMessage,
  splitRequests,
  type BlockEntry,
  type FriendEntry,
  type FriendRequestEntry,
} from "./friends-flow";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...(init?.method && init.method !== "GET" ? { headers: { "Content-Type": "application/json" }, ...init } : init),
  });
  const result = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ApiFailure;
  if (!response.ok) throw new Error(friendErrorMessage(result.error?.code));
  return result.data;
}

export function FriendsView() {
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [requests, setRequests] = useState<FriendRequestEntry[]>([]);
  const [blocks, setBlocks] = useState<BlockEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [pulseId, setPulseId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  const reload = useCallback(async (signal?: AbortSignal) => {
    const [friendList, requestList, blockList] = await Promise.all([
      api<FriendEntry[]>("/api/v1/friends", { signal }),
      api<FriendRequestEntry[]>("/api/v1/friends/requests", { signal }),
      api<BlockEntry[]>("/api/v1/blocks", { signal }),
    ]);
    setFriends(friendList);
    setRequests(requestList);
    setBlocks(blockList);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const load = async (initial: boolean) => {
      try {
        await reload(controller.signal);
        setLoadError("");
      } catch (reason) {
        // Only the initial load may blank the page. A failed 45s refresh keeps
        // the stale lists (and whatever the user is typing) on screen — same
        // discipline as the chat views; the next successful poll catches up.
        if ((reason as Error).name !== "AbortError" && initial) {
          setLoadError((reason as Error).message || "无法加载好友数据");
        }
      } finally {
        if (initial) setLoading(false);
      }
    };
    void load(true);
    // Presence dots go stale within the 90s TTL, so refresh on the shared cadence.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void load(false);
    }, FRIENDS_POLL_INTERVAL_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [reload]);

  async function act(operation: () => Promise<string | void>) {
    setActionError("");
    setNotice("");
    try {
      const message = await operation();
      if (message) setNotice(message);
      await reload();
    } catch (reason) {
      setActionError((reason as Error).message || friendErrorMessage(undefined));
    }
  }

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePulseIdInput(pulseId);
    if (!normalized) { setActionError("PULSE ID 是 3–32 位小写字母、数字或下划线。"); return; }
    setSubmitting(true);
    await act(async () => {
      const result = await api<{ status: "PENDING" | "ACCEPTED" }>("/api/v1/friends/requests", {
        method: "POST", body: JSON.stringify({ pulseId: normalized }),
      });
      setPulseId("");
      return requestOutcomeMessage(result.status);
    });
    setSubmitting(false);
  }

  if (loading) return <DataStatePanel state="loading" title="正在加载好友" description="" />;
  if (loadError) return <DataStatePanel state="error" title="好友数据暂不可用" description={loadError} />;

  const { incoming, outgoing } = splitRequests(requests);

  return <div className="space-y-6">
    {actionError && <StatusMessage tone="error" title="操作失败">{actionError}</StatusMessage>}
    {notice && <StatusMessage tone="success" title={notice} />}

    <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
      <div className="space-y-5">
        <section className="surface p-5 sm:p-7" aria-label="添加好友">
          <p className="eyebrow">ADD FRIEND</p>
          <h2 className="display mt-1 text-2xl font-bold">按 PULSE ID 添加</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">PULSE ID 就是会员通行证上的「NO.」编号，需要输入完整 ID，无法搜索。</p>
          <form onSubmit={sendRequest} className="mt-5 flex flex-wrap gap-3">
            <label htmlFor="pulse-id" className="sr-only">PULSE ID</label>
            <input id="pulse-id" name="pulseId" required value={pulseId} onChange={(event) => setPulseId(event.target.value)}
              placeholder="例如 alice_01" autoComplete="off"
              className="min-h-12 min-w-56 flex-1 rounded-xl border border-[var(--line)] bg-white px-3" />
            <button disabled={submitting} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--field)] px-6 font-bold text-white transition hover:brightness-95 disabled:opacity-45">
              {submitting ? "正在发送…" : "发送申请"}
            </button>
          </form>
        </section>

        <section className="surface p-5 sm:p-7" aria-label="好友列表">
          <p className="eyebrow">FRIENDS</p>
          <h2 className="display mt-1 text-2xl font-bold">好友列表</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">绿点表示对方开启了「向好友展示在线」且最近仍在活动；看不到绿点不代表对方不在线。</p>
          {friends.length === 0
            ? <p className="mt-5 text-sm text-[var(--muted)]">还没有好友。通过上方的 PULSE ID 发出第一份申请吧。</p>
            : <ul className="mt-5 divide-y divide-[var(--line)]">
              {friends.map((friend) => <li key={friend.userId} className="flex flex-wrap items-center gap-3 py-3">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${friend.online ? "bg-emerald-500" : "bg-[var(--line)]"}`} />
                <span className="font-bold">{friend.nickname || friend.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">NO. {friend.pulseId}</span>
                <span className="sr-only">{friend.online ? "在线" : "离线或未展示"}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/${friend.userId}`, { method: "DELETE" }); return "已删除好友。"; })}
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">删除</button>
                  <button type="button" onClick={() => void act(async () => { await api("/api/v1/blocks", { method: "POST", body: JSON.stringify({ pulseId: friend.pulseId }) }); return "已屏蔽。对方不会收到任何提示。"; })}
                    className="rounded-full border border-[var(--coral)] px-3 py-1.5 text-xs font-bold text-[var(--coral)]">屏蔽</button>
                </span>
              </li>)}
            </ul>}
        </section>
      </div>

      <div className="space-y-5">
        <section className="surface p-5 sm:p-7" aria-label="好友申请">
          <p className="eyebrow">REQUESTS</p>
          <h2 className="display mt-1 text-2xl font-bold">好友申请</h2>
          {incoming.length === 0 && outgoing.length === 0 && <p className="mt-5 text-sm text-[var(--muted)]">暂无待处理的申请。</p>}
          {incoming.length > 0 && <div className="mt-5">
            <h3 className="text-sm font-bold">收到的申请</h3>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {incoming.map((request) => <li key={request.requestId} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-bold">{request.nickname || request.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">NO. {request.pulseId}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/requests/${request.requestId}`, { method: "POST", body: JSON.stringify({ action: "accept" }) }); return "已接受申请。"; })}
                    className="rounded-full bg-[var(--field)] px-3 py-1.5 text-xs font-bold text-white">接受</button>
                  <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/requests/${request.requestId}`, { method: "POST", body: JSON.stringify({ action: "decline" }) }); return "已拒绝申请。"; })}
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">拒绝</button>
                </span>
              </li>)}
            </ul>
          </div>}
          {outgoing.length > 0 && <div className="mt-5">
            <h3 className="text-sm font-bold">发出的申请</h3>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {outgoing.map((request) => <li key={request.requestId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-bold">{request.nickname || request.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">等待对方处理</span>
                {/* Requester-side withdrawal is the pair DELETE — decline is recipient-only and would 404. */}
                <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/${request.userId}`, { method: "DELETE" }); return "已撤回申请。"; })}
                  className="ml-auto rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">撤回</button>
              </li>)}
            </ul>
          </div>}
        </section>

        <section className="surface p-5 sm:p-7" aria-label="屏蔽名单">
          <p className="eyebrow">BLOCKED</p>
          <h2 className="display mt-1 text-2xl font-bold">屏蔽名单</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">被屏蔽的成员无法向你发送好友申请，也看不到你的在场状态；对方不会收到任何提示。</p>
          {blocks.length === 0
            ? <p className="mt-5 text-sm text-[var(--muted)]">屏蔽名单为空。</p>
            : <ul className="mt-5 divide-y divide-[var(--line)]">
              {blocks.map((entry) => <li key={entry.userId} className="flex flex-wrap items-center gap-3 py-3">
                <span className="font-bold">{entry.nickname || entry.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">NO. {entry.pulseId}</span>
                <button type="button" onClick={() => void act(async () => { await api(`/api/v1/blocks/${entry.userId}`, { method: "DELETE" }); return "已解除屏蔽。"; })}
                  className="ml-auto rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">解除屏蔽</button>
              </li>)}
            </ul>}
        </section>
      </div>
    </div>
  </div>;
}
