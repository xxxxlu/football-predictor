"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import { useLocale } from "@/components/locale-provider";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { PublicRoomsSection } from "@/features/rooms/public-rooms-section";
import {
  acceptCommunityRulesRequest,
  appendPending,
  CHAT_MESSAGE_MAX,
  CHAT_POLL_INTERVAL_MS,
  chatMessageLength,
  failPending,
  isMutedNow,
  listChannelRequest,
  LOBBY_HEARTBEAT_INTERVAL_MS,
  lobbyHeartbeatRequest,
  lobbyRequest,
  mergeConfirmedChannelMessage,
  normalizeChatInput,
  removePending,
  reportChannelMessageRequest,
  retryPending,
  sendChannelRequest,
  type ChannelMessageRecord,
  type ChannelPageRecord,
  type LobbyData,
  type PendingMessage,
} from "./club-lobby-flow";

/**
 * PULSE CLUB lobby (Story 12.4). Numbered sections in the EditorialHome
 * spirit, each degrading alone; the channel reuses the 12.3 chat form: short
 * polling, optimistic sends with an explicit failed-retry state, an inline
 * report panel, and the rules-confirmation card replacing the input until the
 * server says the rules are confirmed. Every state is written out in text —
 * never colour alone (NFR24–29).
 */
export function ClubLobbyView() {
  const { t } = useLocale();
  const [lobby, setLobby] = useState<LobbyData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [channel, setChannel] = useState<ChannelPageRecord>();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reportTarget, setReportTarget] = useState<ChannelMessageRecord | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [confirmingRules, setConfirmingRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const localSeq = useRef(0);

  const loadLobby = useCallback(async (signal?: AbortSignal) => {
    const { url, init } = lobbyRequest();
    const response = await fetch(url, { ...init, signal });
    const result = await response.json().catch(() => ({})) as ApiEnvelope<LobbyData> & ApiFailure;
    if (!response.ok) throw new Error(result.error?.message || t("club.lobby.unavailable"));
    return result.data;
  }, [t]);

  const loadChannel = useCallback(async (signal?: AbortSignal) => {
    const { url, init } = listChannelRequest();
    const response = await fetch(url, { ...init, signal });
    const result = await response.json().catch(() => ({})) as ApiEnvelope<ChannelPageRecord> & ApiFailure;
    if (!response.ok) throw new Error(result.error?.message || t("club.lobby.sectionUnavailable"));
    return result.data;
  }, [t]);

  // Initial aggregate load; the channel section then keeps itself fresh below.
  useEffect(() => {
    const controller = new AbortController();
    void loadLobby(controller.signal)
      .then((data) => { setLobby(data); if (data.channel) setChannel(data.channel); setError(""); })
      .catch((reason) => { if ((reason as Error).name !== "AbortError") setError((reason as Error).message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [loadLobby]);

  // Channel polling (12.3 cadence), only while the page is visible. A poll
  // failure keeps the already-rendered page; it never tears the channel down.
  useEffect(() => {
    let disposed = false;
    const controllers = new Set<AbortController>();
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const data = await loadChannel(controller.signal);
        if (!disposed) setChannel(data);
      } catch { /* keep stale channel data */ }
      finally { controllers.delete(controller); }
    };
    const interval = window.setInterval(() => { void refresh(); }, CHAT_POLL_INTERVAL_MS);
    return () => { disposed = true; window.clearInterval(interval); for (const controller of controllers) controller.abort(); };
  }, [loadChannel]);

  // Lobby presence heartbeat: fire-and-forget, consent enforced server-side —
  // with every toggle off the server records nothing no matter what we send.
  useEffect(() => {
    const beat = () => {
      if (document.visibilityState === "hidden") return;
      const { url, init } = lobbyHeartbeatRequest();
      void fetch(url, init).catch(() => { /* presence is best-effort */ });
    };
    beat();
    const interval = window.setInterval(beat, LOBBY_HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  const send = useCallback(async (body: string, localId: string) => {
    const { url, init } = sendChannelRequest(body);
    try {
      const response = await fetch(url, init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<ChannelMessageRecord> & ApiFailure;
      if (!response.ok) throw new Error(result.error?.message || t("room.chat.sendFailed"));
      setPending((current) => removePending(current, localId));
      setChannel((current) => current ? { ...current, messages: mergeConfirmedChannelMessage(current.messages, result.data) } : current);
    } catch (reason) {
      setPending((current) => failPending(current, localId, (reason as Error).message || t("room.chat.sendFailed")));
    }
  }, [t]);

  function submitDraft() {
    const body = normalizeChatInput(draft);
    if (!body) return;
    const localId = `local-${localSeq.current += 1}`;
    setPending((current) => appendPending(current, localId, body, new Date().toISOString()));
    setDraft("");
    void send(body, localId);
  }

  function retry(entry: PendingMessage) {
    setPending((current) => retryPending(current, entry.localId));
    void send(entry.body, entry.localId);
  }

  async function submitReport() {
    if (!reportTarget) return;
    setBusy(true); setNotice(null);
    try {
      const { url, init } = reportChannelMessageRequest(reportTarget.id, reportReason.trim());
      const response = await fetch(url, init);
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(result.error?.message || t("room.chat.errorGeneric"));
      setNotice({ tone: "success", text: t("room.chat.reportDone") });
      setReportTarget(null); setReportReason("");
    } catch (reason) {
      setNotice({ tone: "error", text: (reason as Error).message || t("room.chat.errorGeneric") });
    } finally {
      setBusy(false);
    }
  }

  async function confirmRules() {
    setConfirmingRules(true); setNotice(null);
    try {
      const { url, init } = acceptCommunityRulesRequest();
      const response = await fetch(url, init);
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(result.error?.message || t("club.lobby.rulesFailed"));
      // Unlock in place (AC2's recovery path made visible).
      setChannel((current) => current ? { ...current, rulesConfirmed: true } : current);
      setNotice({ tone: "success", text: t("club.lobby.rulesDone") });
    } catch (reason) {
      setNotice({ tone: "error", text: (reason as Error).message || t("club.lobby.rulesFailed") });
    } finally {
      setConfirmingRules(false);
    }
  }

  if (loading && !lobby) return <p className="text-sm text-[var(--muted)]" role="status">{t("club.lobby.loading")}</p>;
  if (!lobby) return <StatusMessage tone="error" title={t("club.lobby.unavailable")}>{error}</StatusMessage>;

  const muted = channel ? isMutedNow(channel.mutedUntil, new Date()) : false;
  const remaining = CHAT_MESSAGE_MAX - chatMessageLength(draft.trim());
  const canSubmit = channel?.rulesConfirmed === true && !muted && normalizeChatInput(draft) !== null;

  return <div className="space-y-10">
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ① Directory */}
      <section className="surface rounded-xl p-5" aria-labelledby="lobby-directory-title">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">01 / PRESENCE</p>
        <h2 id="lobby-directory-title" className="kinetic mt-1 text-2xl">{t("club.lobby.directoryTitle")}</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">{t("club.lobby.directoryHint")}</p>
        {lobby.directory === null
          ? <p className="mt-4 text-sm text-[var(--muted)]" role="status">{t("club.lobby.sectionUnavailable")}</p>
          : lobby.directory.length === 0
            ? <p className="mt-4 text-sm text-[var(--muted)]">{t("club.lobby.directoryEmpty")}</p>
            : <ul className="mt-4 flex flex-wrap gap-2" aria-label={t("club.lobby.directoryTitle")}>
                {lobby.directory.map((entry) => <li key={entry.pulseId} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-sm"><b>{entry.nickname || entry.pulseId}</b><span className="ml-2 text-xs text-[var(--muted)]">@{entry.pulseId}</span></li>)}
              </ul>}
      </section>

      {/* ② Friend activity */}
      <section className="surface rounded-xl p-5" aria-labelledby="lobby-friends-title">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">02 / FRIENDS</p>
        <h2 id="lobby-friends-title" className="kinetic mt-1 text-2xl">{t("club.lobby.friendsTitle")}</h2>
        {lobby.friends === null
          ? <p className="mt-4 text-sm text-[var(--muted)]" role="status">{t("club.lobby.sectionUnavailable")}</p>
          : lobby.friends.friends.length === 0
            ? <p className="mt-4 text-sm text-[var(--muted)]">{t("club.lobby.friendsEmpty")} <Link href="/friends" className="font-bold underline">{t("club.lobby.friendsCta")}</Link></p>
            : <>
                {!lobby.friends.viewerAnswered && <p className="mt-2 text-xs text-[var(--muted)]">{t("club.lobby.friendsLocked")}</p>}
                <ul className="mt-4 divide-y divide-[var(--line)]" aria-label={t("club.lobby.friendsTitle")}>
                  {lobby.friends.friends.map((friend) => <li key={friend.pulseId} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span><b>{friend.nickname || friend.pulseId}</b><span className="ml-2 text-xs text-[var(--muted)]">@{friend.pulseId}</span></span>
                    <span className="flex gap-2 text-xs">
                      <span className={`rounded-full border px-2 py-0.5 font-bold ${friend.online ? "border-[var(--field)] text-[var(--field)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{friend.online ? t("club.lobby.online") : t("club.lobby.offline")}</span>
                      {friend.answeredToday !== null && <span className={`rounded-full border px-2 py-0.5 font-bold ${friend.answeredToday ? "border-[var(--ink)]" : "border-[var(--line)] text-[var(--muted)]"}`}>{friend.answeredToday ? t("club.lobby.answered") : t("club.lobby.notAnswered")}</span>}
                    </span>
                  </li>)}
                </ul>
              </>}
      </section>
    </div>

    {/* ③ Daily activity entry */}
    <section className="surface rounded-xl p-5" aria-labelledby="lobby-daily-title">
      <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">03 / DAILY</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="lobby-daily-title" className="kinetic text-2xl">{t("club.lobby.dailyTitle")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("club.lobby.dailyBody")}</p></div>
        <Link href="/club/daily" className="inline-flex min-h-11 items-center rounded-full bg-[var(--field)] px-5 text-sm font-bold text-white no-underline transition hover:brightness-95">{t("club.lobby.dailyCta")} →</Link>
      </div>
    </section>

    {/* ④ Public room discovery — the extracted rooms-page section, reused as-is. */}
    <PublicRoomsSection headingId="lobby-public-rooms-title" />

    {/* ⑤ Public channel */}
    <section className="surface rounded-xl p-5" aria-labelledby="lobby-channel-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">05 / CHANNEL</p><h2 id="lobby-channel-title" className="kinetic mt-1 text-2xl">{t("club.lobby.channelTitle")}</h2></div>
        <p className="text-xs text-[var(--muted)]">{t("club.lobby.channelHint")}</p>
      </div>
      {notice && <div className="mt-3"><StatusMessage tone={notice.tone} title={notice.text}/></div>}

      {!channel
        ? <p className="mt-4 text-sm text-[var(--muted)]" role="status">{t("club.lobby.sectionUnavailable")}</p>
        : <>
          {reportTarget && <form className="mt-4 rounded-lg border border-[var(--line)] p-4" onSubmit={(event) => { event.preventDefault(); void submitReport(); }}>
            <h3 className="text-sm font-bold">{t("room.chat.reportTitle")}</h3>
            <p className="mt-1 truncate text-xs text-[var(--muted)]">“{reportTarget.body}”</p>
            <label htmlFor="channel-report-reason" className="mt-3 block text-xs font-bold">{t("room.chat.reportReasonLabel")}</label>
            <textarea id="channel-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm" required/>
            <div className="mt-3 flex gap-2">
              <button type="submit" disabled={busy} className="min-h-10 rounded-full bg-[var(--field)] px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-55">{t("room.chat.reportSubmit")}</button>
              <button type="button" className="min-h-10 rounded-full border border-[var(--line)] px-4 text-sm font-bold" onClick={() => setReportTarget(null)}>{t("room.chat.cancel")}</button>
            </div>
          </form>}

          {/* aria-live announces newly polled messages politely without stealing focus. */}
          <ul className="mt-4 divide-y divide-[var(--line)]" aria-live="polite" aria-label={t("club.lobby.channelTitle")}>
            {channel.messages.length === 0 && pending.length === 0 && <li className="py-3 text-sm text-[var(--muted)]">{t("club.lobby.channelEmpty")}</li>}
            {pending.slice().reverse().map((entry) => <li key={entry.localId} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm"><b>{entry.status === "failed" ? t("room.chat.sendFailed") : t("room.chat.sending")}</b></p>
                {entry.status === "failed" && <span className="flex shrink-0 gap-2">
                  <button type="button" className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)]" onClick={() => retry(entry)}>{t("room.chat.retry")}</button>
                  <button type="button" className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)]" onClick={() => setPending((current) => removePending(current, entry.localId))}>{t("room.chat.discard")}</button>
                </span>}
              </div>
              {entry.status === "failed" && entry.error && <p className="mt-1 text-xs text-[var(--coral)]" role="alert">{entry.error}</p>}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--muted)]">{entry.body}</p>
            </li>)}
            {channel.messages.map((message) => <li key={message.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 text-sm">
                  <b className="text-[var(--ink)]">{message.authorNickname || message.authorPulseId}</b>
                  <span className="ml-2 text-xs text-[var(--muted)]">{new Date(message.createdAt).toLocaleString()}</span>
                </p>
                <span className="flex shrink-0 gap-2" aria-label={t("room.chat.actions")}>
                  <button type="button" className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)]" onClick={() => { setReportTarget(message); setReportReason(""); setNotice(null); }}>{t("room.chat.report")}</button>
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
            </li>)}
          </ul>

          {!channel.rulesConfirmed
            ? <div className="mt-4 rounded-lg border-2 border-[var(--ink)] p-4">
                <h3 className="text-sm font-bold">{t("club.lobby.rulesTitle")}</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--muted)]">
                  <li>{t("club.lobby.rulesPoint1")}</li>
                  <li>{t("club.lobby.rulesPoint2")}</li>
                  <li>{t("club.lobby.rulesPoint3")}</li>
                </ul>
                <button type="button" disabled={confirmingRules} onClick={() => void confirmRules()} className="mt-3 min-h-11 rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-55">{t("club.lobby.rulesConfirm")}</button>
              </div>
            : muted && channel.mutedUntil
              ? <p className="mt-4 rounded-lg border border-[var(--line)] px-4 py-3 text-sm" role="status">{t("club.lobby.mutedUntil")} {new Date(channel.mutedUntil).toLocaleString()}</p>
              : <form className="mt-4" onSubmit={(event) => { event.preventDefault(); submitDraft(); }}>
                  <label htmlFor="channel-draft" className="block text-xs font-bold">{t("room.chat.inputLabel")}</label>
                  <div className="mt-2 flex gap-2">
                    <input id="channel-draft" value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm" maxLength={CHAT_MESSAGE_MAX * 2} autoComplete="off"/>
                    <button type="submit" disabled={!canSubmit} className="min-h-11 shrink-0 rounded-full bg-[var(--field)] px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-55">{t("room.chat.send")}</button>
                  </div>
                  <p className={`mt-1 text-xs ${remaining < 0 ? "font-bold text-[var(--coral)]" : "text-[var(--muted)]"}`}>{remaining < 0 ? t("room.chat.tooLong") : `${chatMessageLength(draft.trim())}/${CHAT_MESSAGE_MAX}`}</p>
                </form>}
        </>}
    </section>
  </div>;
}
