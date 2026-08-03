"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StatusMessage } from "@/components/status-message";
import { useLocale } from "@/components/locale-provider";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import {
  appendPending,
  CHAT_MESSAGE_MAX,
  CHAT_POLL_INTERVAL_MS,
  chatErrorKey,
  chatMessageLength,
  dropDeliveredPending,
  failPending,
  isMutedNow,
  listChatRequest,
  mergeConfirmed,
  MUTE_DURATION_OPTIONS,
  reconcileMessages,
  muteMemberRequest,
  normalizeChatInput,
  pinChatRequest,
  removePending,
  reportChatMessageRequest,
  retryPending,
  sendChatRequest,
  unmuteMemberRequest,
  unpinChatRequest,
  type ChatMessageRecord,
  type ChatPageRecord,
  type PendingMessage,
} from "./room-chat-flow";

type MemberOption = { userId: string; username: string; isOwner: boolean };

/**
 * Room public chat (Story 12.3). Plain text only; polling keeps the visible
 * page fresh, sends are optimistic with an explicit failed-retry state, and
 * every moderation entry point (report / pin / mute) uses an inline reason
 * panel — never window.prompt.
 */
export function RoomChatView({ roomId, members }: { roomId: string; members: MemberOption[] }) {
  const { t } = useLocale();
  const [page, setPage] = useState<ChatPageRecord>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reportTarget, setReportTarget] = useState<ChatMessageRecord | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [muteTarget, setMuteTarget] = useState<{ memberUserId: string } | null>(null);
  const [muteHours, setMuteHours] = useState<number>(24);
  const [muteReason, setMuteReason] = useState("");
  const [unmuteTarget, setUnmuteTarget] = useState<{ muteId: string; pulseId: string } | null>(null);
  const [unmuteReason, setUnmuteReason] = useState("");
  const [busy, setBusy] = useState(false);
  const localSeq = useRef(0);
  // Learned from the first confirmed send this mount: the send response's
  // authorPulseId IS the viewer. Used to retire optimistic rows only when the
  // poll shows OUR message — never a stranger's identical text.
  const viewerPulseId = useRef<string | null>(null);
  const reportReasonRef = useRef<HTMLTextAreaElement>(null);
  const muteReasonRef = useRef<HTMLTextAreaElement>(null);
  const unmuteReasonRef = useRef<HTMLTextAreaElement>(null);

  // The inline panels render ABOVE the message list; without moving focus a
  // keyboard or screen-reader user activating 举报/禁言 on a deep message never
  // learns the form opened (NFR25).
  useEffect(() => { if (reportTarget) reportReasonRef.current?.focus(); }, [reportTarget]);
  useEffect(() => { if (muteTarget) muteReasonRef.current?.focus(); }, [muteTarget]);
  useEffect(() => { if (unmuteTarget) unmuteReasonRef.current?.focus(); }, [unmuteTarget]);

  const load = useCallback(async (signal?: AbortSignal) => {
    const { url, init } = listChatRequest(roomId);
    const response = await fetch(url, { ...init, signal });
    const result = await response.json().catch(() => ({})) as ApiEnvelope<ChatPageRecord> & ApiFailure;
    // Render by error CODE through i18n — the server message is English-only.
    if (!response.ok) throw new Error(result.error?.code ? t(chatErrorKey(result.error.code)) : t("room.chat.unavailable"));
    return result.data;
  }, [roomId, t]);

  useEffect(() => {
    let disposed = false;
    const controllers = new Set<AbortController>();
    const refresh = async () => {
      // Poll only while the page is actually visible (15–30s cadence).
      if (document.visibilityState === "hidden") return;
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const data = await load(controller.signal);
        if (!disposed) {
          // Reconcile, don't replace: a stale snapshot must not erase a
          // just-confirmed send; a landed poll retires its "sending…" row.
          setPage((current) => current ? { ...data, messages: reconcileMessages(current.messages, data.messages) } : data);
          setPending((current) => dropDeliveredPending(current, data.messages, viewerPulseId.current));
          setError("");
        }
      } catch (reason) {
        if (!disposed && (reason as Error).name !== "AbortError") {
          setError(reason instanceof TypeError ? t("room.chat.unavailable") : (reason as Error).message);
        }
      } finally {
        controllers.delete(controller);
        if (!disposed) setLoading(false);
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, CHAT_POLL_INTERVAL_MS);
    return () => { disposed = true; window.clearInterval(interval); for (const controller of controllers) controller.abort(); };
  }, [load, t]);

  const send = useCallback(async (body: string, localId: string) => {
    const { url, init } = sendChatRequest(roomId, body);
    try {
      const response = await fetch(url, init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<ChatMessageRecord> & ApiFailure;
      if (!response.ok) throw new Error(result.error?.code ? t(chatErrorKey(result.error.code)) : t("room.chat.sendFailed"));
      viewerPulseId.current = result.data.authorPulseId;
      setPending((current) => removePending(current, localId));
      setPage((current) => current ? { ...current, messages: mergeConfirmed(current.messages, result.data) } : current);
    } catch (reason) {
      // A network-level TypeError carries browser English ("Failed to fetch") —
      // fold it to the localized generic instead of leaking it into the row.
      const text = reason instanceof TypeError ? t("room.chat.sendFailed") : (reason as Error).message || t("room.chat.sendFailed");
      setPending((current) => failPending(current, localId, text));
    }
  }, [roomId, t]);

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

  async function act(request: { url: string; init: RequestInit }, done: string) {
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(t(chatErrorKey(result.error?.code)));
      setNotice({ tone: "success", text: done });
      setReportTarget(null); setReportReason("");
      setMuteTarget(null); setMuteReason("");
      setUnmuteTarget(null); setUnmuteReason("");
      // Same reconciliation as the poll path: a raw replace here would erase a
      // send confirmed while this moderation action was in flight.
      const data = await load();
      setPage((current) => current ? { ...data, messages: reconcileMessages(current.messages, data.messages) } : data);
      setPending((current) => dropDeliveredPending(current, data.messages, viewerPulseId.current));
    } catch (reason) {
      const text = reason instanceof TypeError ? t("room.chat.errorGeneric") : (reason as Error).message || t("room.chat.errorGeneric");
      setNotice({ tone: "error", text });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !page) return <section className="surface p-5" aria-labelledby="room-chat-title"><h2 id="room-chat-title" className="display text-2xl font-bold">{t("room.chat.title")}</h2><p className="mt-3 text-sm text-[var(--muted)]" role="status">{t("room.chat.loading")}</p></section>;
  // A transient poll failure must not tear down an already-rendered chat —
  // the full error panel is only for a chat that never loaded.
  if (!page) return <section className="surface p-5" aria-labelledby="room-chat-title"><h2 id="room-chat-title" className="display text-2xl font-bold">{t("room.chat.title")}</h2><div className="mt-3"><StatusMessage tone="error" title={t("room.chat.unavailable")}>{error}</StatusMessage></div></section>;

  const muted = isMutedNow(page.mutedUntil, new Date());
  const remaining = CHAT_MESSAGE_MAX - chatMessageLength(draft.trim());
  const canSubmit = page.canPost && !muted && normalizeChatInput(draft) !== null;
  // Owner-only mute targets: the owner cannot mute themselves (the server 422s
  // a self-mute), so their own messages carry no mute entry point.
  const mutableMembers = members.filter((member) => !member.isOwner);
  const mutableMemberFor = (message: ChatMessageRecord) => mutableMembers.find((member) => member.username.toLowerCase() === message.authorPulseId.toLowerCase());

  const renderMessage = (message: ChatMessageRecord, pinnedBanner = false) => (
    <li key={pinnedBanner ? `pinned-${message.id}` : message.id} className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-sm">
          <b className="text-[var(--ink)]">{message.authorNickname || message.authorPulseId}</b>
          <span className="ml-2 text-xs text-[var(--muted)]">{new Date(message.createdAt).toLocaleString()}</span>
          {(pinnedBanner || message.isPinned) && <span className="ml-2 rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide">{t("room.chat.pinnedLabel")}</span>}
        </p>
        <span className="flex shrink-0 gap-2" aria-label={t("room.chat.actions")}>
          <button type="button" className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)]" onClick={() => { setReportTarget(message); setReportReason(""); setNotice(null); }}>{t("room.chat.report")}</button>
          {page.isOwner && (pinnedBanner || message.isPinned
            ? <button type="button" disabled={busy} className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)] disabled:opacity-50" onClick={() => void act(unpinChatRequest(roomId, message.id), t("room.chat.unpinned"))}>{t("room.chat.unpin")}</button>
            : <button type="button" disabled={busy} className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)] disabled:opacity-50" onClick={() => void act(pinChatRequest(roomId, message.id), t("room.chat.pinnedDone"))}>{t("room.chat.pin")}</button>)}
          {page.isOwner && mutableMemberFor(message) && <button type="button" className="min-h-8 rounded-full border border-[var(--coral)] px-3 text-xs font-bold text-[var(--coral)] transition hover:bg-[var(--coral)] hover:text-white" onClick={() => { setMuteTarget({ memberUserId: mutableMemberFor(message)!.userId }); setMuteReason(""); setNotice(null); }}>{t("room.chat.mute")}</button>}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
    </li>
  );

  return <section className="surface p-5" aria-labelledby="room-chat-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="room-chat-title" className="display text-2xl font-bold">{t("room.chat.title")}</h2>
      <p className="text-xs text-[var(--muted)]">{t("room.chat.inputHint")}</p>
    </div>
    {notice && <div className="mt-3"><StatusMessage tone={notice.tone} title={notice.text}/></div>}

    {page.pinned && <div className="mt-4 rounded-lg border-2 border-[var(--ink)] px-4">
      <ul>{renderMessage(page.pinned, true)}</ul>
    </div>}

    {reportTarget && <form className="mt-4 rounded-lg border border-[var(--line)] p-4" onSubmit={(event) => { event.preventDefault(); void act(reportChatMessageRequest(roomId, reportTarget.id, reportReason.trim()), t("room.chat.reportDone")); }}>
      <h3 className="text-sm font-bold">{t("room.chat.reportTitle")}</h3>
      <p className="mt-1 truncate text-xs text-[var(--muted)]">“{reportTarget.body}”</p>
      <label htmlFor="chat-report-reason" className="mt-3 block text-xs font-bold">{t("room.chat.reportReasonLabel")}</label>
      <textarea id="chat-report-reason" ref={reportReasonRef} value={reportReason} onChange={(event) => setReportReason(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm" required/>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy} className="min-h-10 rounded-full bg-[var(--field)] px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-55">{t("room.chat.reportSubmit")}</button>
        <button type="button" className="min-h-10 rounded-full border border-[var(--line)] px-4 text-sm font-bold" onClick={() => setReportTarget(null)}>{t("room.chat.cancel")}</button>
      </div>
    </form>}

    {muteTarget && page.isOwner && <form className="mt-4 rounded-lg border border-[var(--line)] p-4" onSubmit={(event) => { event.preventDefault(); void act(muteMemberRequest(roomId, { memberUserId: muteTarget.memberUserId, muteHours, reason: muteReason.trim() }), t("room.chat.muteDone")); }}>
      <h3 className="text-sm font-bold">{t("room.chat.muteTitle")}</h3>
      <label htmlFor="chat-mute-member" className="mt-3 block text-xs font-bold">{t("room.chat.muteMemberLabel")}</label>
      <select id="chat-mute-member" value={muteTarget.memberUserId} onChange={(event) => setMuteTarget({ memberUserId: event.target.value })} className="mt-2 min-h-10 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm">
        {mutableMembers.map((member) => <option key={member.userId} value={member.userId}>{member.username}</option>)}
      </select>
      <label htmlFor="chat-mute-hours" className="mt-3 block text-xs font-bold">{t("room.chat.muteDuration")}</label>
      <select id="chat-mute-hours" value={muteHours} onChange={(event) => setMuteHours(Number(event.target.value))} className="mt-2 min-h-10 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm">
        {MUTE_DURATION_OPTIONS.map((option) => <option key={option.hours} value={option.hours}>{t(option.labelKey)}</option>)}
      </select>
      <label htmlFor="chat-mute-reason" className="mt-3 block text-xs font-bold">{t("room.chat.muteReasonLabel")}</label>
      <textarea id="chat-mute-reason" ref={muteReasonRef} value={muteReason} onChange={(event) => setMuteReason(event.target.value)} rows={2} className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm" required/>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy} className="min-h-10 rounded-full bg-[var(--coral)] px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-55">{t("room.chat.muteSubmit")}</button>
        <button type="button" className="min-h-10 rounded-full border border-[var(--line)] px-4 text-sm font-bold" onClick={() => setMuteTarget(null)}>{t("room.chat.cancel")}</button>
      </div>
    </form>}

    {unmuteTarget && page.isOwner && <form className="mt-4 rounded-lg border border-[var(--line)] p-4" onSubmit={(event) => { event.preventDefault(); void act(unmuteMemberRequest(roomId, unmuteTarget.muteId, unmuteReason.trim()), t("room.chat.unmuteDone")); }}>
      <h3 className="text-sm font-bold">{t("room.chat.unmute")} · {unmuteTarget.pulseId}</h3>
      <label htmlFor="chat-unmute-reason" className="mt-3 block text-xs font-bold">{t("room.chat.unmuteReasonLabel")}</label>
      <textarea id="chat-unmute-reason" ref={unmuteReasonRef} value={unmuteReason} onChange={(event) => setUnmuteReason(event.target.value)} rows={2} className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-sm" required/>
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={busy} className="min-h-10 rounded-full bg-[var(--field)] px-4 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-55">{t("room.chat.unmute")}</button>
        <button type="button" className="min-h-10 rounded-full border border-[var(--line)] px-4 text-sm font-bold" onClick={() => setUnmuteTarget(null)}>{t("room.chat.cancel")}</button>
      </div>
    </form>}

    {page.isOwner && page.mutes && page.mutes.length > 0 && <div className="mt-4 rounded-lg border border-[var(--line)] p-4">
      <h3 className="text-sm font-bold">{t("room.chat.muteList")}</h3>
      <ul className="mt-2 divide-y divide-[var(--line)]">
        {page.mutes.map((mute) => <li key={mute.muteId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
          <span><b>{mute.nickname || mute.pulseId}</b><span className="ml-2 text-xs text-[var(--muted)]">{t("room.chat.muteListUntil")} {new Date(mute.mutedUntil).toLocaleString()}</span></span>
          <button type="button" className="min-h-8 rounded-full border border-[var(--line)] px-3 text-xs font-bold transition hover:border-[var(--ink)]" onClick={() => { setUnmuteTarget({ muteId: mute.muteId, pulseId: mute.pulseId }); setUnmuteReason(""); setNotice(null); }}>{t("room.chat.unmute")}</button>
        </li>)}
      </ul>
    </div>}

    {/* role="log" (implicit polite live region with additions-only semantics):
        a bare aria-live list re-announces swaths of history on every poll
        reconciliation instead of just the new entries. It lives on a wrapper
        so the <ul> keeps its list role — role="log" directly on the <ul>
        orphans the <li> children (axe: listitem). */}
    <div role="log" aria-label={t("room.chat.title")}>
    <ul className="mt-4 divide-y divide-[var(--line)]">
      {page.messages.length === 0 && pending.length === 0 && <li className="py-3 text-sm text-[var(--muted)]">{t("room.chat.empty")}</li>}
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
      {page.messages.map((message) => renderMessage(message))}
    </ul>
    </div>

    {muted && page.mutedUntil
      ? <p className="mt-4 rounded-lg border border-[var(--line)] px-4 py-3 text-sm" role="status">{t("room.chat.mutedUntil")} {new Date(page.mutedUntil).toLocaleString()}</p>
      : !page.canPost
        ? <p className="mt-4 rounded-lg border border-[var(--line)] px-4 py-3 text-sm" role="status">{t("room.chat.roomNotActive")}</p>
        : <form className="mt-4" onSubmit={(event) => { event.preventDefault(); submitDraft(); }}>
            <label htmlFor="chat-draft" className="block text-xs font-bold">{t("room.chat.inputLabel")}</label>
            <div className="mt-2 flex gap-2">
              <input id="chat-draft" value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-sm" maxLength={CHAT_MESSAGE_MAX * 2} autoComplete="off"/>
              <button type="submit" disabled={!canSubmit} className="min-h-11 shrink-0 rounded-full bg-[var(--field)] px-5 text-sm font-bold text-white transition hover:brightness-95 disabled:opacity-55">{t("room.chat.send")}</button>
            </div>
            <p className={`mt-1 text-xs ${remaining < 0 ? "font-bold text-[var(--coral)]" : "text-[var(--muted)]"}`}>{remaining < 0 ? t("room.chat.tooLong") : `${chatMessageLength(draft.trim())}/${CHAT_MESSAGE_MAX}`}</p>
          </form>}
  </section>;
}
