"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { GovernanceConfirmPanel } from "./admin-governance-view";
import {
  DEFAULT_AUDIT_FILTERS,
  GROUP_LABELS,
  RESULT_LABELS,
  TARGET_LABELS,
  auditActionLabel,
  cardLabel,
  loadAudit,
  loadFailedJobs,
  loadOverview,
  retryJob,
  severityLabel,
  type AuditEvent,
  type AuditFilters,
  type FailedJob,
  type OperationsOverview,
  type OverviewSection,
  type Severity,
} from "./admin-overview-flow";

/**
 * Unified operations overview and permission audit (FR58, FR60, FR81, FR90).
 *
 * One screen answers what needs attention and who did what. The cards are the
 * server's answer to the first question — it returns only the sections the
 * operator's duties cover, so this component renders what it is given rather than
 * deciding what to hide. The two sections below load independently and simply do
 * not render when the server refuses them, exactly as the governance inbox does.
 *
 * The audit trail is filterable and reachable by correlation id, so an audit
 * number from a report timeline or a member notice resolves to one entry.
 */
const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });

/** Reads the audit jump target off the URL. Server-rendered, this is simply empty. */
function initialFilters(): AuditFilters {
  if (typeof window === "undefined") return DEFAULT_AUDIT_FILTERS;
  const audit = new URLSearchParams(window.location.search).get("audit");
  return audit ? { ...DEFAULT_AUDIT_FILTERS, correlationId: audit } : DEFAULT_AUDIT_FILTERS;
}

export function AdminStatusView() {
  const [overview, setOverview] = useState<OperationsOverview>();
  const [jobs, setJobs] = useState<FailedJob[]>();
  const [audit, setAudit] = useState<AuditEvent[]>();
  // NFR37: an audit number from a report timeline or a member notice arrives as
  // ?audit=<id> and lands the trail on that one entry.
  const [filters, setFilters] = useState<AuditFilters>(initialFilters);
  const [applied, setApplied] = useState<AuditFilters>(initialFilters);
  const [reloadToken, setReloadToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState<FailedJob>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    loadOverview().then(
      (result) => { if (!active) return; setOverview(result); setLoading(false); },
      (reason: Error) => { if (!active) return; setForbidden(true); setError(reason.message); setLoading(false); },
    );
    // A refused section stays undefined and renders nothing: a duty an operator
    // does not hold is not an error worth shouting about.
    void loadFailedJobs().then((result) => { if (active) setJobs(result); }, () => undefined);
    void loadAudit(fetch, applied).then((result) => { if (active) setAudit(result); }, () => undefined);
    return () => { active = false; };
  }, [reloadToken, applied]);

  async function confirmRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setSuccess("");
    try {
      const result = await retryJob(fetch, {
        jobId: pending.id,
        reason: String(form.get("reason") || ""),
        password: String(form.get("password") || ""),
      });
      setPending(undefined);
      setSuccess(`${pending.kind} 已重新排队，将在下一轮调度中被领取，审计编号 ${result.auditId}`);
      setReloadToken((token) => token + 1);
    } catch (failure) { setError((failure as Error).message || "重试失败"); }
    finally { setBusy(false); }
  }

  if (loading) return <DataStatePanel state="loading" title="正在加载运营总览" description=""/>;
  if (forbidden || !overview) {
    return <DataStatePanel state="forbidden" title="没有查看运营总览的权限"
      description={error || "此页面只对持有运营职责的账户开放。系统不会向普通用户或房主返回运营数据。"}/>;
  }

  return <div className="space-y-6">
    <header className="surface flex flex-wrap items-center justify-between gap-4 p-5">
      <div>
        <p className="text-xs text-[var(--muted)]">综合状态</p>
        <p className={`mt-1 text-xl font-bold ${tone(overview.overall)}`}>{severityLabel(overview.overall)}</p>
      </div>
      <time className="tabular text-xs text-[var(--muted)]" dateTime={overview.generatedAt.toISOString()}>
        生成于 {dateTime.format(overview.generatedAt)}
      </time>
    </header>

    {success && <StatusMessage tone="success" title="操作已记录">{success}</StatusMessage>}
    {error && <StatusMessage tone="error" title="操作失败">{error}</StatusMessage>}

    {pending && <GovernanceConfirmPanel
      title={`确认重新排队 ${pending.kind}`}
      note="任务会回到队列并在下一轮调度中被重新领取，重跑的是同一份工作：载荷、重试计数与已有结果都不会改写，赔率、结算与账本也不受影响。"
      verb="重新排队" reasonLabel="重试理由（写入审计，不会通知任何成员）"
      busy={busy} onSubmit={confirmRetry} onCancel={() => setPending(undefined)}/>}

    <div className="grid gap-4 lg:grid-cols-2">
      {overview.sections.map((section) => <Card key={section.card} section={section}/>)}
    </div>

    <p className="text-xs leading-5 text-[var(--muted)]">
      总览只汇总你已获授权的范围，不会因为聚合而扩大读取；页面不返回密码、恢复码、完整会话令牌、精确位置、未封盘的预测选择或账本明细。
    </p>

    {jobs && <section className="surface p-5" id="failed-jobs" aria-labelledby="failed-jobs-title">
      <h2 id="failed-jobs-title" className="display text-2xl font-bold">失败任务</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        重试只是把任务放回队列并清掉退避等待，由后台在下一轮调度中重新领取；不会就地执行，也不会修改任务载荷或已有结果。
      </p>
      {jobs.length === 0 ? <p className="mt-4 text-sm text-[var(--muted)]">当前没有失败任务。</p> : <ul className="mt-4 space-y-3">
        {jobs.map((job) => <li key={job.id} className="rounded-xl border border-[var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <strong className="break-all">{job.kind}</strong>
              <p className="mt-1 text-xs text-[var(--muted)]">
                第 {job.attempt} 次重试 · 已执行 {job.runCount} 次 · {job.lastErrorCode ?? "未记录错误码"} · 失败于 {dateTime.format(job.updatedAt)}
              </p>
            </div>
            <button type="button" disabled={busy}
              onClick={() => { setError(""); setSuccess(""); setPending(job); }}
              className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-xs font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-50">重新排队</button>
          </div>
        </li>)}
      </ul>}
    </section>}

    {audit && <section className="surface p-5" id="audit" aria-labelledby="audit-title">
      <h2 id="audit-title" className="display text-2xl font-bold">权限审计</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        职责变更、账户处置、房间治理、社区处置与任务重试都在同一条时间线上。举报详情与成员通知里的审计编号可以直接填进「审计编号」查到对应记录。
      </p>

      <form className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(event) => { event.preventDefault(); setApplied(filters); }}>
        <FilterSelect label="动作类别" value={filters.group} labels={GROUP_LABELS}
          onChange={(value) => setFilters({ ...filters, group: value as AuditFilters["group"], action: "" })}/>
        <FilterSelect label="对象类型" value={filters.targetType} labels={TARGET_LABELS}
          onChange={(value) => setFilters({ ...filters, targetType: value as AuditFilters["targetType"] })}/>
        <FilterSelect label="结果" value={filters.result} labels={RESULT_LABELS}
          onChange={(value) => setFilters({ ...filters, result: value as AuditFilters["result"] })}/>
        <FilterText label="操作者用户名" value={filters.actor} placeholder="片段匹配"
          onChange={(value) => setFilters({ ...filters, actor: value })}/>
        <FilterText label="对象 ID" value={filters.targetId} placeholder="完整 UUID"
          onChange={(value) => setFilters({ ...filters, targetId: value })}/>
        <FilterText label="审计编号" value={filters.correlationId} placeholder="完整 UUID"
          onChange={(value) => setFilters({ ...filters, correlationId: value })}/>
        <FilterDate label="起始时间" value={filters.from} onChange={(value) => setFilters({ ...filters, from: value })}/>
        <FilterDate label="截止时间" value={filters.to} onChange={(value) => setFilters({ ...filters, to: value })}/>
        <div className="flex flex-wrap items-end gap-3 sm:col-span-2 lg:col-span-4">
          <button className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 font-bold text-white transition hover:bg-[var(--field)]">筛选</button>
          <button type="button" onClick={() => { setFilters(DEFAULT_AUDIT_FILTERS); setApplied(DEFAULT_AUDIT_FILTERS); }}
            className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">清除筛选</button>
        </div>
      </form>

      {audit.length === 0
        ? <p className="mt-5 text-sm text-[var(--muted)]">没有符合当前筛选条件的审计记录。</p>
        : <ul className="mt-5 divide-y divide-[var(--line)]">{audit.map((event) => <li key={event.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <strong>{auditActionLabel(event.action)}</strong>
            <span className="text-xs text-[var(--muted)]">{TARGET_LABELS[event.targetType as AuditFilters["targetType"]] ?? event.targetType}:{event.targetId}</span>
            {event.result !== "SUCCESS" && <span className="text-xs font-bold text-[var(--coral)]">{event.result}</span>}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {event.actor ?? "系统"} · {dateTime.format(event.occurredAt)} · 审计 {event.id}
          </p>
          <Metadata value={event.metadata}/>
        </li>)}</ul>}
    </section>}

    <div className="flex flex-wrap gap-5">
      <Link href="/admin/users" className="font-bold underline">管理普通用户状态</Link>
      <Link href="/admin/moderation" className="font-bold underline">进入治理收件箱</Link>
    </div>
  </div>;
}

function Card({ section }: { section: OverviewSection }) {
  return <section className="surface p-5" aria-labelledby={`card-${section.card}`}>
    <header className="flex items-center justify-between gap-3">
      <h2 id={`card-${section.card}`} className="display text-xl font-bold">{cardLabel(section.card)}</h2>
      <span className={`text-xs font-bold ${tone(section.severity)}`}>{severityLabel(section.severity)}</span>
    </header>
    <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
      {section.metrics.map((metric) => <div key={metric.key}>
        <dt className="text-[10px] text-[var(--muted)]">{metric.label}</dt>
        <dd className="tabular mt-1 break-all font-bold">{metric.value}</dd>
      </div>)}
    </dl>
    {section.detail && <p className="mt-3 text-xs text-[var(--muted)]">{section.detail}</p>}
    {/* The next step carries its own capability, so it only arrives when the
        operator may actually perform it. */}
    {section.nextStep && <p className="mt-4">
      <Link href={section.nextStep.href} className="text-sm font-bold underline">{section.nextStep.label}</Link>
    </p>}
  </section>;
}

function Metadata({ value }: { value: unknown }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return null;
  return <p className="mt-1 break-all text-xs text-[var(--muted)]">
    {entries.map(([key, entry]) => `${key}=${typeof entry === "object" ? JSON.stringify(entry) : String(entry)}`).join(" · ")}
  </p>;
}

function FilterSelect({ label, value, labels, onChange }: { label: string; value: string; labels: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="block text-sm font-bold">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal">
      {Object.entries(labels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </label>;
}

function FilterText({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-bold">{label}
    <input value={value} placeholder={placeholder} maxLength={64} onChange={(event) => onChange(event.target.value)}
      className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal"/>
  </label>;
}

function FilterDate({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-bold">{label}
    <input type="date" value={value} onChange={(event) => onChange(event.target.value)}
      className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal"/>
  </label>;
}

function tone(severity: Severity) {
  return severity === "OK" ? "text-[var(--field)]" : severity === "WATCH" ? "text-[var(--amber)]" : "text-[var(--coral)]";
}
