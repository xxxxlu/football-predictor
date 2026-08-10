"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Avatar, AvatarWithPresence } from "@/components/avatar";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { useLocale } from "@/components/locale-provider";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import type { MessageKey } from "@/lib/i18n/messages";
import {
  friendErrorKey,
  FRIENDS_POLL_INTERVAL_MS,
  normalizePulseIdInput,
  requestOutcomeKey,
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
  // Carry the KEY, not rendered text: the caller owns the locale.
  if (!response.ok) throw Object.assign(new Error(result.error?.code ?? ""), { messageKey: friendErrorKey(result.error?.code) });
  return result.data;
}

function errorKeyOf(reason: unknown): MessageKey {
  const key = (reason as { messageKey?: MessageKey }).messageKey;
  return key ?? "friends.err.generic";
}

export function FriendsView() {
  const { t } = useLocale();
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
          setLoadError(t(errorKeyOf(reason)));
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
  }, [reload, t]);

  async function act(operation: () => Promise<MessageKey | void>) {
    setActionError("");
    setNotice("");
    try {
      const messageKey = await operation();
      if (messageKey) setNotice(t(messageKey));
    } catch (reason) {
      setActionError(t(errorKeyOf(reason)));
      return;
    }
    // The mutation already succeeded — a failed follow-up refresh must not
    // masquerade as its failure. Stale lists self-heal on the 45s poll.
    await reload().catch(() => {});
  }

  async function sendRequest(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizePulseIdInput(pulseId);
    if (!normalized) { setActionError(t("friends.pulseIdInvalid")); return; }
    setSubmitting(true);
    await act(async () => {
      const result = await api<{ status: "PENDING" | "ACCEPTED" }>("/api/v1/friends/requests", {
        method: "POST", body: JSON.stringify({ pulseId: normalized }),
      });
      setPulseId("");
      return requestOutcomeKey(result.status);
    });
    setSubmitting(false);
  }

  if (loading) return <DataStatePanel state="loading" title={t("friends.loading")} description="" />;
  if (loadError) return <DataStatePanel state="error" title={t("friends.unavailable")} description={loadError} />;

  const { incoming, outgoing } = splitRequests(requests);

  return <div className="space-y-6">
    {actionError && <StatusMessage tone="error" title={t("friends.actionFailed")}>{actionError}</StatusMessage>}
    {notice && <StatusMessage tone="success" title={notice} />}

    <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
      <div className="space-y-5">
        <section className="surface p-5 sm:p-7" aria-label={t("friends.addAria")}>
          <p className="eyebrow">ADD FRIEND</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("friends.addTitle")}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("friends.addHint")}</p>
          <form onSubmit={sendRequest} className="mt-5 flex flex-wrap gap-3">
            <label htmlFor="pulse-id" className="sr-only">PULSE ID</label>
            <input id="pulse-id" name="pulseId" required value={pulseId} onChange={(event) => setPulseId(event.target.value)}
              placeholder={t("friends.pulseIdPlaceholder")} autoComplete="off"
              className="min-h-12 min-w-56 flex-1 rounded-xl border border-[var(--line)] bg-white px-3" />
            <button disabled={submitting} className="inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--field)] px-6 font-bold text-white transition hover:brightness-95 disabled:opacity-45">
              {submitting ? t("friends.sendingRequest") : t("friends.sendRequest")}
            </button>
          </form>
        </section>

        <section className="surface p-5 sm:p-7" aria-label={t("friends.listTitle")}>
          <p className="eyebrow">FRIENDS</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("friends.listTitle")}</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("friends.listHint")}</p>
          {friends.length === 0
            ? <p className="mt-5 text-sm text-[var(--muted)]">{t("friends.empty")}</p>
            : <ul className="mt-5 divide-y divide-[var(--line)]">
              {friends.map((friend) => <li key={friend.userId} className="flex flex-wrap items-center gap-3 py-3">
                {/* The presence dot rides the avatar's corner (12.6); the
                    screen-reader wording below stays the accessible source. */}
                <AvatarWithPresence online={friend.online} src={friend.avatarUrl} version={friend.avatarVersion}
                  nickname={friend.nickname} pulseId={friend.pulseId} size={40} />
                <span className="font-bold">{friend.nickname || friend.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">NO. {friend.pulseId}</span>
                <span className="sr-only">{friend.online ? t("friends.online") : t("friends.offline")}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/${friend.userId}`, { method: "DELETE" }); return "friends.removed"; })}
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">{t("friends.remove")}</button>
                  <button type="button" onClick={() => void act(async () => { await api("/api/v1/blocks", { method: "POST", body: JSON.stringify({ pulseId: friend.pulseId }) }); return "friends.blockedDone"; })}
                    className="rounded-full border border-[var(--coral)] px-3 py-1.5 text-xs font-bold text-[var(--coral)]">{t("friends.block")}</button>
                </span>
              </li>)}
            </ul>}
        </section>
      </div>

      <div className="space-y-5">
        <section className="surface p-5 sm:p-7" aria-label={t("friends.requestsTitle")}>
          <p className="eyebrow">REQUESTS</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("friends.requestsTitle")}</h2>
          {incoming.length === 0 && outgoing.length === 0 && <p className="mt-5 text-sm text-[var(--muted)]">{t("friends.requestsEmpty")}</p>}
          {incoming.length > 0 && <div className="mt-5">
            <h3 className="text-sm font-bold">{t("friends.incoming")}</h3>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {incoming.map((request) => <li key={request.requestId} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar src={request.avatarUrl} version={request.avatarVersion} nickname={request.nickname} pulseId={request.pulseId} size={36} />
                <span className="font-bold">{request.nickname || request.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">NO. {request.pulseId}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/requests/${request.requestId}`, { method: "POST", body: JSON.stringify({ action: "accept" }) }); return "friends.accepted"; })}
                    className="rounded-full bg-[var(--field)] px-3 py-1.5 text-xs font-bold text-white">{t("friends.accept")}</button>
                  <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/requests/${request.requestId}`, { method: "POST", body: JSON.stringify({ action: "decline" }) }); return "friends.declined"; })}
                    className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">{t("friends.decline")}</button>
                </span>
              </li>)}
            </ul>
          </div>}
          {outgoing.length > 0 && <div className="mt-5">
            <h3 className="text-sm font-bold">{t("friends.outgoing")}</h3>
            <ul className="mt-2 divide-y divide-[var(--line)]">
              {outgoing.map((request) => <li key={request.requestId} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <Avatar src={request.avatarUrl} version={request.avatarVersion} nickname={request.nickname} pulseId={request.pulseId} size={36} />
                <span className="font-bold">{request.nickname || request.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">{t("friends.awaiting")}</span>
                {/* Requester-side withdrawal is the pair DELETE — decline is recipient-only and would 404. */}
                <button type="button" onClick={() => void act(async () => { await api(`/api/v1/friends/${request.userId}`, { method: "DELETE" }); return "friends.withdrawn"; })}
                  className="ml-auto rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">{t("friends.withdraw")}</button>
              </li>)}
            </ul>
          </div>}
        </section>

        <section className="surface p-5 sm:p-7" aria-label={t("friends.blocksTitle")}>
          <p className="eyebrow">BLOCKED</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("friends.blocksTitle")}</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("friends.blocksHint")}</p>
          {blocks.length === 0
            ? <p className="mt-5 text-sm text-[var(--muted)]">{t("friends.blocksEmpty")}</p>
            : <ul className="mt-5 divide-y divide-[var(--line)]">
              {blocks.map((entry) => <li key={entry.userId} className="flex flex-wrap items-center gap-3 py-3">
                {/* A block stops the pair seeing each other's photo, so the server
                    sends no URL here — this renders the muted initials fallback. */}
                <Avatar src={entry.avatarUrl} version={entry.avatarVersion} nickname={entry.nickname} pulseId={entry.pulseId} size={36} muted />
                <span className="font-bold">{entry.nickname || entry.pulseId}</span>
                <span className="text-xs text-[var(--muted)]">NO. {entry.pulseId}</span>
                <button type="button" onClick={() => void act(async () => { await api(`/api/v1/blocks/${entry.userId}`, { method: "DELETE" }); return "friends.unblocked"; })}
                  className="ml-auto rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">{t("friends.unblock")}</button>
              </li>)}
            </ul>}
        </section>
      </div>
    </div>
  </div>;
}
