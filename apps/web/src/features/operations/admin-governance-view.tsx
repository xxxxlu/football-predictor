"use client";
import Link from "next/link";
import { FormEvent, useEffect, useId, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import {
  ASSIGNEE_FILTER_LABELS, DEFAULT_INBOX_FILTERS, KIND_FILTER_LABELS, KIND_LABELS,
  MAX_REASON_LENGTH, MIN_REASON_LENGTH, MUTE_HOUR_OPTIONS, MUTE_LABELS,
  SEVERITY_FILTER_LABELS, SEVERITY_LABELS, STATUS_FILTER_LABELS, STATUS_LABELS,
  applyDisposition, buildInboxQuery, dispositionLabel, governanceActionLabel, liftMute,
  loadInbox, loadReportDetail, requiresMuteDuration, triageReport,
  type HistoryEntry, type InboxFilters, type MuteHours, type QueuedReport, type ReportDetail, type ReportDisposition,
} from "./admin-governance-flow";

/**
 * Room and community governance inbox (FR81, FR83, FR90).
 *
 * One queue for room and message reports, filtered by kind, state, severity and
 * assignee. Opening a report shows only what is needed to decide it — for a room
 * report the room's status and size, for a message report the reported message
 * and nothing around it — plus that report's own audit trail.
 *
 * Every disposition goes through a second confirmation that asks for a written
 * reason and the operator's own password, and the server records who did what,
 * to whom and why. Which dispositions appear here comes from the server's own
 * capability answer; hiding a control is a courtesy, not the security boundary.
 */
type Pending =
  | { kind: "DISPOSE"; report: QueuedReport; disposition: ReportDisposition }
  | { kind: "MUTE_LIFT"; report: QueuedReport };

const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

export function AdminGovernanceView() {
  const [filters, setFilters] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  const [draft, setDraft] = useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  // A completed disposition bumps this token; every reader re-runs against the
  // server rather than patching a local copy, so the queue never shows a state
  // the server would disagree with.
  const [reloadToken, setReloadToken] = useState(0);
  const [reports, setReports] = useState<QueuedReport[]>();
  const [detailId, setDetailId] = useState<string>();
  const [detail, setDetail] = useState<ReportDetail>();
  const [detailError, setDetailError] = useState("");
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadInbox(fetch, filters).then(
      (data) => { if (!active) return; setReports(data.reports); setError(""); setLoading(false); },
      (reason: unknown) => { if (!active) return; setError((reason as Error).message || "无法加载治理收件箱"); setLoading(false); },
    );
    return () => { active = false; };
  }, [filters, reloadToken]);

  useEffect(() => {
    if (!detailId) return;
    let active = true;
    void loadReportDetail(fetch, detailId).then(
      (data) => { if (!active) return; setDetail(data); setDetailError(""); },
      (reason: unknown) => { if (!active) return; setDetail(undefined); setDetailError((reason as Error).message || "无法加载举报详情"); },
    );
    return () => { active = false; };
  }, [detailId, reloadToken]);

  const startAction = (next: Pending) => { setPending(next); setError(""); setSuccess(""); };
  const applyFilters = (next: InboxFilters) => { setLoading(true); setSuccess(""); setFilters(next); };

  async function claim(report: QueuedReport, assign: "ME" | "NONE") {
    setBusy(true); setError(""); setSuccess("");
    try {
      await triageReport(fetch, { reportId: report.reportId, assign });
      setSuccess(assign === "ME" ? `已认领 ${report.subject} 的举报` : `已释放 ${report.subject} 的举报`);
      setReloadToken((token) => token + 1);
    } catch (failure) { setError((failure as Error).message || "认领未完成"); }
    finally { setBusy(false); }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pending) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "");
    const password = String(form.get("password") || "");
    const muteHours = Number(form.get("muteHours") || 0) as MuteHours;
    setBusy(true); setError(""); setSuccess("");
    try {
      const message = await apply(pending, reason, password, muteHours);
      setPending(undefined);
      setSuccess(message);
      setReloadToken((token) => token + 1);
    } catch (failure) { setError((failure as Error).message || "处置未完成"); }
    finally { setBusy(false); }
  }

  if (!reports && !error) return <DataStatePanel state="loading" title="正在加载治理收件箱" description=""/>;
  if (!reports) return <DataStatePanel state="error" title="治理收件箱暂不可用" description={error}/>;

  const filtered = buildInboxQuery(filters);
  return <div className="space-y-5">
    {success && <StatusMessage tone="success" title="处置已记录">{success}</StatusMessage>}
    {error && <StatusMessage tone="error" title="处置未完成">{error}</StatusMessage>}

    <section className="surface p-5">
      <p className="eyebrow">GOVERNANCE INBOX</p>
      <h2 className="display mt-1 text-2xl font-bold">治理收件箱</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        这里只出现你职责范围内的举报：房间治理职责看房间举报，社区治理职责看消息举报。
        每条举报只展示处理它所需的最小上下文——未被举报的聊天内容、私人账本与未封盘选择都不在其中。
        每次处置都需要重新确认身份、填写理由，并即时通知受影响成员与写入审计。
      </p>
      <form onSubmit={(event) => { event.preventDefault(); applyFilters({ ...draft }); }} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterSelect label="举报类型" value={draft.kind} labels={KIND_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, kind: value as InboxFilters["kind"] })}/>
        <FilterSelect label="处理状态" value={draft.status} labels={STATUS_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, status: value as InboxFilters["status"] })}/>
        <FilterSelect label="严重度" value={draft.severity} labels={SEVERITY_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, severity: value as InboxFilters["severity"] })}/>
        <FilterSelect label="处理人" value={draft.assignee} labels={ASSIGNEE_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, assignee: value as InboxFilters["assignee"] })}/>
        <div className="flex items-end gap-3 sm:col-span-2">
          <button disabled={loading} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-50">{loading ? "正在筛选…" : "应用筛选"}</button>
          <button type="button" onClick={() => { setDraft(DEFAULT_INBOX_FILTERS); applyFilters(DEFAULT_INBOX_FILTERS); }} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 font-bold transition hover:bg-[var(--ink)] hover:text-white">重置</button>
        </div>
      </form>
    </section>

    <section className="surface p-5" aria-labelledby="governance-queue-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="governance-queue-title" className="display text-2xl font-bold">举报队列</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">认领只是分工，不改变任何成员看到的内容，因此不需要理由；处置才需要。</p>
        </div>
        <span className="text-xs text-[var(--muted)]">{filtered ? `已筛选 · ${reports.length} 条` : `待处理 ${reports.length} 条`}</span>
      </div>
      {reports.length === 0
        ? <p className="mt-5 text-sm text-[var(--muted)]">没有符合条件的举报。</p>
        : <ul className="mt-5 divide-y divide-[var(--line)]">{reports.map((report) => <li key={report.reportId} className="flex flex-wrap items-start justify-between gap-4 py-4">
            <div className="min-w-0">
              <strong>{report.subject}</strong>
              <span className="ml-2 text-xs text-[var(--muted)]">{KIND_LABELS[report.kind]}</span>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                <span className={report.severity === "HIGH" ? "font-bold" : undefined}>严重度 {SEVERITY_LABELS[report.severity]}</span>
                <span>{STATUS_LABELS[report.status]}</span>
                <span>举报人 {report.reporter}</span>
                <span>{dateTime.format(report.createdAt)}</span>
                {report.assignee && <span>{report.assignedToMe ? "我已认领" : `处理人 ${report.assignee}`}</span>}
              </p>
              <p className="mt-2 max-w-prose text-sm">{report.reason}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setDetailId(report.reportId)} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">详情</button>
              {report.status !== "RESOLVED" && report.status !== "DISMISSED" && <button type="button" disabled={busy} onClick={() => void claim(report, report.assignedToMe ? "NONE" : "ME")}
                className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-50">{report.assignedToMe ? "释放" : "认领"}</button>}
            </div>
          </li>)}</ul>}
    </section>

    {detailError && <StatusMessage tone="error" title="举报详情不可用">{detailError}</StatusMessage>}
    {detail && <ReportDetailPanel detail={detail} onClose={() => { setDetailId(undefined); setDetail(undefined); }} onAction={startAction}/>}
    {pending && <GovernanceConfirmPanel
      title={pending.kind === "MUTE_LIFT" ? `确认解除 ${pending.report.subject} 的禁言` : `确认对 ${pending.report.subject} ${dispositionLabel(pending.disposition)}`}
      note={pending.kind === "MUTE_LIFT" ? NOTES.MUTE_LIFT : DISPOSITION_NOTES[pending.disposition]}
      verb={pending.kind === "MUTE_LIFT" ? "解除禁言" : dispositionLabel(pending.disposition)}
      needsMuteDuration={pending.kind === "DISPOSE" && requiresMuteDuration(pending.disposition)}
      busy={busy} onSubmit={confirm} onCancel={() => setPending(undefined)}/>}
  </div>;
}

function FilterSelect({ label, value, labels, onChange }: { label: string; value: string; labels: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="block text-sm font-bold">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal">
      {Object.entries(labels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </label>;
}

function ReportDetailPanel({ detail, onClose, onAction }: { detail: ReportDetail; onClose: () => void; onAction: (pending: Pending) => void }) {
  const closed = detail.status === "RESOLVED" || detail.status === "DISMISSED";
  const muted = detail.message?.mutedUntil ?? null;
  return <section className="surface border-2 border-[var(--ink)] p-5" aria-labelledby="report-detail-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow">REPORT</p>
        <h2 id="report-detail-title" className="display mt-1 text-2xl font-bold">{KIND_LABELS[detail.kind]}：{detail.subject}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {STATUS_LABELS[detail.status]} · 严重度 {SEVERITY_LABELS[detail.severity]} · 举报人 {detail.reporter} · {dateTime.format(detail.createdAt)}
        </p>
      </div>
      <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">收起</button>
    </div>

    <h3 className="mt-5 font-bold">举报理由</h3>
    <p className="mt-2 max-w-prose text-sm">{detail.reason}</p>

    {detail.room && <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Fact label="房间" value={detail.room.roomName}/>
      <Fact label="房间状态" value={detail.room.roomStatus}/>
      <Fact label="成员数" value={`${detail.room.memberCount} 位`}/>
      <Fact label="未处理举报" value={`${detail.room.openReportCount} 条`}/>
    </dl>}

    {detail.message && <div className="mt-5 rounded-xl border border-[var(--line)] p-4">
      <p className="text-xs font-bold uppercase text-[var(--muted)]">被举报的消息（仅此一条）</p>
      <p className="mt-2 text-sm">{detail.message.body}</p>
      <p className="mt-2 text-xs text-[var(--muted)]">
        {detail.message.author} · {detail.message.roomName} · {dateTime.format(detail.message.sentAt)}
        {detail.message.hidden ? " · 当前已隐藏" : ""}
        {muted ? ` · 禁言至 ${dateTime.format(muted)}` : ""}
      </p>
    </div>}

    {detail.availableDispositions.length > 0 && !closed && <div className="mt-5 flex flex-wrap gap-2">
      {detail.availableDispositions.map((disposition) => <button key={disposition} type="button" onClick={() => onAction({ kind: "DISPOSE", report: detail, disposition })}
        className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">{dispositionLabel(disposition)}</button>)}
    </div>}
    {closed && muted && detail.availableDispositions.length > 0 && <div className="mt-5">
      <button type="button" onClick={() => onAction({ kind: "MUTE_LIFT", report: detail })}
        className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">提前解除禁言</button>
    </div>}
    {closed && !muted && <p className="mt-5 text-sm text-[var(--muted)]">这条举报已经处置完毕，不能再次改判；如有新情况请另行举报。</p>}

    <h3 className="mt-6 font-bold">处理时间线</h3>
    {detail.history.length === 0
      ? <p className="mt-2 text-sm text-[var(--muted)]">这条举报还没有处理记录。</p>
      : <ol className="mt-3 space-y-3 border-l-2 border-[var(--line)] pl-4">{detail.history.map((entry) => <TimelineEntry key={entry.id} entry={entry}/>)}</ol>}
  </section>;
}

function TimelineEntry({ entry }: { entry: HistoryEntry }) {
  const metadata = typeof entry.metadata === "object" && entry.metadata !== null ? entry.metadata as { reason?: unknown; disposition?: unknown } : {};
  const reason = typeof metadata.reason === "string" ? metadata.reason : "";
  const disposition = typeof metadata.disposition === "string" ? metadata.disposition : "";
  return <li>
    <p className="text-sm font-bold">
      {governanceActionLabel(entry.action)}
      {disposition && <span className="ml-2 text-xs font-normal text-[var(--muted)]">{dispositionLabel(disposition as ReportDisposition)}</span>}
      {entry.result !== "SUCCESS" && <span className="ml-2 text-xs font-normal text-[var(--muted)]">{entry.result}</span>}
    </p>
    {/* NFR37: the audit id is the correlation id, so it links straight to the one
        matching entry in the platform-wide trail. Operators without AUDIT_READ are
        refused there — the link is a shortcut, never a way in. */}
    <p className="mt-1 text-xs text-[var(--muted)]">
      {dateTime.format(entry.occurredAt)}{entry.actor ? ` · ${entry.actor}` : ""} ·{" "}
      <Link href={`/admin/status?audit=${encodeURIComponent(entry.id)}#audit`} className="underline">审计 {entry.id}</Link>
    </p>
    {reason && <p className="mt-1 text-sm">{reason}</p>}
  </li>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--line)] p-4">
    <dt className="text-xs font-bold uppercase text-[var(--muted)]">{label}</dt>
    <dd className="mt-1 text-sm font-bold">{value}</dd>
  </div>;
}

const NOTES = {
  MUTE_LIFT: "禁言会立即结束，该成员马上可以重新发言。处置记录与审计不会被删除，只会追加一条解除记录。",
} as const;

const DISPOSITION_NOTES: Record<ReportDisposition, string> = {
  RESTRICT_ROOM: "房间将停止接受新的预测，成员仍可查看已有记录。房间内的积分、票据与结算不受影响。",
  CLOSE_ROOM: "房间将被关闭，不再接受预测。已有战绩、票据与账本记录全部保留，不做删除。",
  RESTORE_ROOM: "房间恢复为正常状态，成员可以继续预测。",
  HIDE_MESSAGE: "该条消息将对其他成员隐藏，作者会收到说明。消息本身不会被删除，随时可以恢复。",
  RESTORE_MESSAGE: "该条消息重新对成员可见，作者会收到说明。",
  MUTE_MEMBER: "该成员将在这个房间内暂时无法发言，到期自动恢复；你也可以提前解除。其账户、积分与预测都不受影响。",
  DISMISS: "举报将被标记为无需处理并关闭，举报人会收到说明。被举报的内容与房间保持原样。",
};

/**
 * Shared second confirmation for every governance write: what will happen, a
 * written reason that lands in the audit trail, and the operator's own password.
 */
export function GovernanceConfirmPanel({ title, note, verb, needsMuteDuration = false, needsReason = true, reasonLabel = "处置理由（写入审计并通知受影响成员）", busy, onSubmit, onCancel }: {
  title: string; note: string; verb: string; needsMuteDuration?: boolean; needsReason?: boolean;
  /** Operations writes that notify nobody say so, rather than promising a notice. */
  reasonLabel?: string; busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void;
}) {
  // The heading id is generated per mount. The moderation page renders this panel
  // and the room-governance one together, so a fixed id put two elements with the
  // same id on screen and left `aria-labelledby` pointing at whichever came first.
  const headingId = useId();
  return <section className="surface border-2 border-[var(--ink)] p-5" aria-labelledby={headingId}>
    <h2 id={headingId} className="display text-xl font-bold">{title}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{note}</p>
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      {needsMuteDuration && <label className="block text-sm font-bold">禁言时长
        <select name="muteHours" defaultValue={24} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal">
          {MUTE_HOUR_OPTIONS.map((hours) => <option key={hours} value={hours}>{MUTE_LABELS[hours]}</option>)}
        </select>
      </label>}
      {needsReason && <label className="block text-sm font-bold">{reasonLabel}
        <textarea name="reason" required minLength={MIN_REASON_LENGTH} maxLength={MAX_REASON_LENGTH} rows={3} autoFocus
          placeholder={`${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} 字，说明处置依据`}
          className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 font-normal"/>
      </label>}
      <label className="block text-sm font-bold">当前管理员密码
        <input name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={128}
          className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] px-3"/>
      </label>
      <p className="text-xs text-[var(--muted)]">身份确认结果最多有效 5 分钟，且只对后台接口生效。</p>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-50">{busy ? "正在确认…" : `确认${verb}`}</button>
        <button type="button" disabled={busy} onClick={onCancel} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">取消</button>
      </div>
    </form>
  </section>;
}

/** Applies one confirmed disposition and returns the sentence the operator should see. */
async function apply(pending: Pending, reason: string, password: string, muteHours: MuteHours): Promise<string> {
  if (pending.kind === "MUTE_LIFT") {
    const result = await liftMute(fetch, { reportId: pending.report.reportId, reason, password });
    return `${pending.report.subject} 的禁言已解除，审计编号 ${result.auditId}`;
  }
  const result = await applyDisposition(fetch, {
    reportId: pending.report.reportId, disposition: pending.disposition, reason, password,
    ...(requiresMuteDuration(pending.disposition) ? { muteHours } : {}),
  });
  return `${pending.report.subject}：${dispositionLabel(result.disposition)}已执行，已通知 ${result.notifiedUsers} 位成员，审计编号 ${result.auditId}`;
}
