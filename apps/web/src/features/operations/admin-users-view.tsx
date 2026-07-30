"use client";
import { FormEvent, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import {
  ACTIVITY_FILTER_LABELS, DEFAULT_USER_FILTERS, MAX_REASON_LENGTH, MIN_REASON_LENGTH,
  RESTRICTION_FILTER_LABELS, STATUS_FILTER_LABELS,
  actionLabel, activityLabel, buildUserQuery, completeAnonymization, fileAnonymization,
  loadAdminUsers, loadAnonymizationQueue, loadAudienceStats, loadUserDetail, revokeUserSessions, updateAdminUserStatus,
  type AccountStatus, type ActivityFilter, type AnonymizationRequest, type AudienceDimension, type AudienceStats,
  type GovernanceEntry, type ManagedUser, type ManagedUserDetail, type RestrictionFilter, type StatusFilter, type UserFilters,
} from "./admin-users-flow";

/**
 * User security and lifecycle console (FR81, FR82).
 *
 * Search and narrow the roster, open one account's overview and governance
 * timeline, then take a lifecycle action behind a second confirmation that asks
 * for a written reason and the operator's own password. This screen only shows
 * what the server chose to project: no credential, no session token, no precise
 * location, no unsealed pick, no ledger figure — and it offers no way to edit a
 * balance, a prediction or a settlement (FR59). Hiding a control here is a
 * courtesy, not the security boundary; the server checks every request.
 */
type Pending =
  | { kind: "STATUS"; user: ManagedUser; status: AccountStatus }
  | { kind: "SESSIONS"; user: ManagedUser }
  | { kind: "ANONYMIZE_REQUEST"; user: ManagedUser }
  | { kind: "ANONYMIZE_COMPLETE"; user: ManagedUser; requestId: string };

const dateTime = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const day = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" });

export function AdminUsersView() {
  const [filters, setFilters] = useState<UserFilters>(DEFAULT_USER_FILTERS);
  const [draft, setDraft] = useState<UserFilters>(DEFAULT_USER_FILTERS);
  // A completed action bumps this token; every reader re-runs against the server
  // rather than patching a local copy, so the console never shows a state the
  // server would disagree with.
  const [reloadToken, setReloadToken] = useState(0);
  const [users, setUsers] = useState<ManagedUser[]>();
  const [detailId, setDetailId] = useState<string>();
  const [detail, setDetail] = useState<ManagedUserDetail>();
  const [detailError, setDetailError] = useState("");
  const [queue, setQueue] = useState<AnonymizationRequest[]>([]);
  const [audience, setAudience] = useState<AudienceStats>();
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void loadAdminUsers(fetch, filters).then(
      (data) => { if (!active) return; setUsers(data); setError(""); setLoading(false); },
      (reason: unknown) => { if (!active) return; setError((reason as Error).message || "无法加载用户列表"); setLoading(false); },
    );
    return () => { active = false; };
  }, [filters, reloadToken]);

  useEffect(() => {
    let active = true;
    // The roster is the primary view; a queue failure must not blank it.
    void loadAnonymizationQueue().then((data) => { if (active) setQueue(data); }, () => undefined);
    return () => { active = false; };
  }, [reloadToken]);

  useEffect(() => {
    if (!detailId) return;
    let active = true;
    void loadUserDetail(fetch, detailId).then(
      (data) => { if (!active) return; setDetail(data); setDetailError(""); },
      (reason: unknown) => { if (!active) return; setDetail(undefined); setDetailError((reason as Error).message || "无法加载账户概览"); },
    );
    return () => { active = false; };
  }, [detailId, reloadToken]);

  useEffect(() => { let active = true; void loadAudienceStats().then((data) => { if (active) setAudience(data); }, () => undefined); return () => { active = false; }; }, []);

  const startAction = (next: Pending) => { setPending(next); setError(""); setSuccess(""); };
  const applyFilters = (next: UserFilters) => { setLoading(true); setSuccess(""); setFilters(next); };

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pending) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") || "");
    const password = String(form.get("password") || "");
    setBusy(true); setError(""); setSuccess("");
    try {
      const message = await apply(pending, reason, password);
      setPending(undefined);
      setSuccess(message);
      setReloadToken((token) => token + 1);
    } catch (failure) { setError((failure as Error).message || "操作未完成"); }
    finally { setBusy(false); }
  }

  if (!users && !error) return <DataStatePanel state="loading" title="正在加载用户安全台" description=""/>;
  if (!users) return <DataStatePanel state="error" title="用户安全台暂不可用" description={error}/>;

  const queryHint = buildUserQuery(filters);
  return <div className="space-y-5">
    {success && <StatusMessage tone="success" title="处置已记录">{success}</StatusMessage>}
    {error && <StatusMessage tone="error" title="操作未完成">{error}</StatusMessage>}

    <section className="surface p-5">
      <p className="eyebrow">USER SECURITY</p>
      <h2 className="display mt-1 text-2xl font-bold">用户安全与生命周期</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
        这里只展示身份、安全状态与统计数量：不包含密码、恢复码、会话令牌、精确位置、未封盘选择或账本明细，也没有任何修改余额、预测与结算的入口。
        禁用、撤销会话与匿名化都需要重新确认身份、填写理由，并即时写入审计。
      </p>
      <form onSubmit={(event) => { event.preventDefault(); applyFilters({ ...draft }); }} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm font-bold">用户名搜索
          <input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} maxLength={32} placeholder="按用户名片段匹配"
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal"/>
        </label>
        <FilterSelect label="账户状态" value={draft.status} labels={STATUS_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, status: value as StatusFilter })}/>
        <FilterSelect label="活跃度" value={draft.activity} labels={ACTIVITY_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, activity: value as ActivityFilter })}/>
        <FilterSelect label="社区限制" value={draft.restriction} labels={RESTRICTION_FILTER_LABELS} onChange={(value) => setDraft({ ...draft, restriction: value as RestrictionFilter })}/>
        <label className="block text-sm font-bold">最少加入房间数
          <input type="number" min={0} max={1000} value={draft.minRooms} onChange={(event) => setDraft({ ...draft, minRooms: Math.max(0, Number(event.target.value) || 0) })}
            className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal"/>
        </label>
        <div className="flex items-end gap-3">
          <button disabled={loading} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-50">{loading ? "正在筛选…" : "应用筛选"}</button>
          <button type="button" onClick={() => { setDraft(DEFAULT_USER_FILTERS); applyFilters(DEFAULT_USER_FILTERS); }} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 font-bold transition hover:bg-[var(--ink)] hover:text-white">重置</button>
        </div>
      </form>
    </section>

    {queue.length > 0 && <section className="surface p-5" aria-labelledby="anonymization-queue-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">LIFECYCLE</p>
          <h2 id="anonymization-queue-title" className="display mt-1 text-2xl font-bold">待处理匿名化申请</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">申请受理后 7 天内必须完成。匿名化只移除公开身份，历史战绩与账本记录保留且不可删除。</p>
        </div>
        <span className="text-xs text-[var(--muted)]">共 {queue.length} 条</span>
      </div>
      <ul className="mt-4 divide-y divide-[var(--line)]">{queue.map((request) => <li key={request.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
        <div>
          <strong>{request.username}</strong>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {request.overdue ? <span className="font-bold text-[var(--danger,#b3261e)]">已逾期</span> : `剩余 ${request.daysRemaining} 天`}
            {" · 截止 "}{day.format(request.dueAt)}{request.reason ? ` · ${request.reason}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setDetailId(request.userId)} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">查看账户</button>
          <button type="button" onClick={() => startAction({ kind: "ANONYMIZE_COMPLETE", user: { id: request.userId, username: request.username } as ManagedUser, requestId: request.id })}
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--ink)] px-4 text-sm font-bold text-white transition hover:bg-[var(--field)]">完成匿名化</button>
        </div>
      </li>)}</ul>
    </section>}

    <section className="surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-2xl font-bold">用户列表</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">禁用会同时结束该用户全部会话；单独撤销会话只结束当前设备，用户仍可重新登录。</p>
        </div>
        <span className="text-xs text-[var(--muted)]">{queryHint ? `已筛选 · ${users.length} 个结果` : `共 ${users.length} 个`}</span>
      </div>
      {users.length === 0
        ? <p className="mt-5 text-sm text-[var(--muted)]">没有符合条件的用户。</p>
        : <ul className="mt-5 divide-y divide-[var(--line)]">{users.map((user) => <li key={user.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <strong>{user.nickname || user.username}</strong>
              {user.nickname && <span className="ml-2 text-xs text-[var(--muted)]">@{user.username}</span>}
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                <span>{user.status === "ACTIVE" ? "● 已启用" : "■ 已禁用"}</span>
                <span>{activityLabel(user.activityBucket)}</span>
                <span>会话 {user.activeSessionCount}</span>
                <span>房间 {user.roomCount}</span>
                {user.communityRestricted && <span className="font-bold">名下 {user.restrictedRoomCount} 个房间被限制</span>}
                {user.openReportCount > 0 && <span className="font-bold">待处理举报 {user.openReportCount}</span>}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setDetailId(user.id)} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">概览</button>
              <button type="button" onClick={() => startAction({ kind: "STATUS", user, status: user.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}
                className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">{user.status === "ACTIVE" ? "禁用账户" : "恢复账户"}</button>
            </div>
          </li>)}</ul>}
    </section>

    {detailError && <StatusMessage tone="error" title="账户概览不可用">{detailError}</StatusMessage>}
    {detail && <UserDetailPanel detail={detail} onClose={() => { setDetailId(undefined); setDetail(undefined); }} onAction={startAction}/>}

    {pending && <ConfirmPanel pending={pending} busy={busy} onSubmit={confirm} onCancel={() => setPending(undefined)}/>}
    {audience && <AudienceOverview stats={audience}/>}
  </div>;
}

function FilterSelect({ label, value, labels, onChange }: { label: string; value: string; labels: Record<string, string>; onChange: (value: string) => void }) {
  return <label className="block text-sm font-bold">{label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 font-normal">
      {Object.entries(labels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    </select>
  </label>;
}

function UserDetailPanel({ detail, onClose, onAction }: { detail: ManagedUserDetail; onClose: () => void; onAction: (pending: Pending) => void }) {
  const openRequest = detail.anonymization?.status === "RECEIVED";
  return <section className="surface border-2 border-[var(--ink)] p-5" aria-labelledby="user-detail-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="eyebrow">OVERVIEW</p>
        <h2 id="user-detail-title" className="display mt-1 text-2xl font-bold">{detail.nickname || detail.username}</h2>
        <p className="mt-1 text-xs text-[var(--muted)]">@{detail.username}{detail.operatorRoles.length ? ` · 运营职责 ${detail.operatorRoles.length} 项` : ""}</p>
      </div>
      <button type="button" onClick={onClose} className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">收起</button>
    </div>

    <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Fact label="账户状态" value={detail.status === "ACTIVE" ? "已启用" : "已禁用"}/>
      <Fact label="注册时间" value={day.format(detail.registeredAt)}/>
      <Fact label="最近活跃" value={detail.lastSeenAt ? `${dateTime.format(detail.lastSeenAt)}（${activityLabel(detail.activityBucket)}）` : activityLabel(detail.activityBucket)}/>
      <Fact label="有效会话" value={`${detail.activeSessionCount} 个`}/>
      <Fact label="房间" value={`加入 ${detail.roomCount} · 创建 ${detail.ownedRoomCount} · 被限制 ${detail.restrictedRoomCount}`}/>
      <Fact label="待处理举报" value={`${detail.openReportCount} 条`}/>
    </dl>

    {detail.anonymization && <p className="mt-4 rounded-xl border border-[var(--line)] p-4 text-sm">
      匿名化申请：{detail.anonymization.status === "COMPLETED" ? "已完成" : detail.anonymization.overdue ? "受理中（已逾期）" : `受理中，剩余 ${detail.anonymization.daysRemaining} 天`}
      <span className="text-[var(--muted)]">　截止 {day.format(detail.anonymization.dueAt)}</span>
    </p>}

    <div className="mt-5 flex flex-wrap gap-2">
      <button type="button" onClick={() => onAction({ kind: "STATUS", user: detail, status: detail.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}
        className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">{detail.status === "ACTIVE" ? "禁用账户" : "恢复账户"}</button>
      <button type="button" disabled={detail.activeSessionCount === 0} onClick={() => onAction({ kind: "SESSIONS", user: detail })}
        className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-45">撤销全部会话</button>
      {openRequest
        ? <span className="self-center text-xs text-[var(--muted)]">匿名化申请已在队列中，请在上方队列完成处置。</span>
        : detail.status === "ACTIVE" && <button type="button" onClick={() => onAction({ kind: "ANONYMIZE_REQUEST", user: detail })}
            className="inline-flex min-h-10 items-center justify-center rounded-full border-2 border-[var(--ink)] px-4 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white">登记匿名化申请</button>}
    </div>

    <h3 className="mt-6 font-bold">操作时间线</h3>
    {detail.governanceHistory.length === 0
      ? <p className="mt-2 text-sm text-[var(--muted)]">这个账户还没有运营处置记录。</p>
      : <ol className="mt-3 space-y-3 border-l-2 border-[var(--line)] pl-4">{detail.governanceHistory.map((entry) => <TimelineEntry key={entry.id} entry={entry}/>)}</ol>}
  </section>;
}

function TimelineEntry({ entry }: { entry: GovernanceEntry }) {
  const reason = typeof entry.metadata === "object" && entry.metadata !== null ? (entry.metadata as { reason?: unknown }).reason : undefined;
  return <li>
    <p className="text-sm font-bold">{actionLabel(entry.action)}{entry.result !== "SUCCESS" && <span className="ml-2 text-xs font-normal text-[var(--muted)]">{entry.result}</span>}</p>
    <p className="mt-1 text-xs text-[var(--muted)]">{dateTime.format(entry.occurredAt)}{entry.actor ? ` · ${entry.actor}` : ""}</p>
    {typeof reason === "string" && reason && <p className="mt-1 text-sm">{reason}</p>}
  </li>;
}

const PENDING_COPY: Record<Pending["kind"], { verb: string; note: string }> = {
  STATUS: { verb: "状态变更", note: "禁用会立即结束该用户全部会话并阻止登录；恢复后用户可以重新登录。已有战绩与账本不受影响。" },
  SESSIONS: { verb: "撤销全部会话", note: "该用户当前所有设备会立即退出登录，但账户仍然可用，可以重新登录。" },
  ANONYMIZE_REQUEST: { verb: "登记匿名化申请", note: "登记后开始 7 天服务时限。此步骤只受理申请，不会立即移除公开身份。" },
  ANONYMIZE_COMPLETE: { verb: "完成匿名化", note: "公开身份将被替换为匿名标识并结束全部会话。历史战绩与账本记录保留，不做物理删除。" },
};

function ConfirmPanel({ pending, busy, onSubmit, onCancel }: { pending: Pending; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onCancel: () => void }) {
  const copy = PENDING_COPY[pending.kind];
  // The confirm button names the action it is about to take — a generic "确认执行"
  // on a panel that can disable an account is exactly the wrong place to be vague.
  const verb = pending.kind === "STATUS" ? (pending.status === "DISABLED" ? "禁用" : "恢复") : copy.verb;
  const title = pending.kind === "STATUS" ? `确认${verb} ${pending.user.username}` : `确认对 ${pending.user.username} ${verb}`;
  return <section className="surface border-2 border-[var(--ink)] p-5" aria-labelledby="admin-confirm-title">
    <h2 id="admin-confirm-title" className="display text-xl font-bold">{title}</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{copy.note}</p>
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <label className="block text-sm font-bold">操作理由（写入审计）
        <textarea name="reason" required minLength={MIN_REASON_LENGTH} maxLength={MAX_REASON_LENGTH} rows={3} autoFocus
          placeholder={`${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} 字，说明处置依据`}
          className="mt-2 w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 font-normal"/>
      </label>
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

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-[var(--line)] p-4">
    <dt className="text-xs font-bold uppercase text-[var(--muted)]">{label}</dt>
    <dd className="mt-1 text-sm font-bold">{value}</dd>
  </div>;
}

/** Applies one confirmed action and returns the sentence the operator should see. */
async function apply(pending: Pending, reason: string, password: string): Promise<string> {
  if (pending.kind === "STATUS") {
    const result = await updateAdminUserStatus(fetch, { userId: pending.user.id, status: pending.status, reason, password });
    return `${pending.user.username} 已${result.status === "DISABLED" ? "禁用" : "恢复"}，审计编号 ${result.auditId}`;
  }
  if (pending.kind === "SESSIONS") {
    const result = await revokeUserSessions(fetch, { userId: pending.user.id, reason, password });
    return `${pending.user.username} 的 ${result.revokedSessions} 个会话已撤销，审计编号 ${result.auditId}`;
  }
  if (pending.kind === "ANONYMIZE_REQUEST") {
    const result = await fileAnonymization(fetch, { userId: pending.user.id, reason, password });
    return `${pending.user.username} 的匿名化申请已登记，需在 7 天内完成，审计编号 ${result.auditId}`;
  }
  const result = await completeAnonymization(fetch, { userId: pending.user.id, requestId: pending.requestId, reason, password });
  return `${pending.user.username} 的公开身份已匿名化，审计编号 ${result.auditId}`;
}

function AudienceOverview({ stats }: { stats: AudienceStats }) {
  return <section className="surface p-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="eyebrow">Audience</p>
        <h2 className="display mt-1 text-2xl font-bold">用户地域与终端</h2>
      </div>
      <span className="text-sm font-bold">已识别地域 {stats.locatedUsers}/{stats.totalUsers}</span>
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Dimension title="国家/地区" items={stats.countries}/>
      <Dimension title="城市" items={stats.cities}/>
      <Dimension title="设备类型" items={stats.deviceClasses}/>
      <Dimension title="操作系统" items={stats.operatingSystems}/>
      <Dimension title="浏览器" items={stats.browsers}/>
    </div>
    <p className="mt-4 text-xs text-[var(--muted)]">聚合统计，基于注册或最近一次成功登录的 IP 粗粒度定位；不落到单个账户，也不是精确住址。</p>
  </section>;
}

function Dimension({ title, items }: { title: string; items: AudienceDimension[] }) {
  return <div className="rounded-xl border border-[var(--line)] p-4">
    <h3 className="font-bold">{title}</h3>
    {items.length
      ? <ul className="mt-3 space-y-2 text-sm">{items.slice(0, 5).map((item) => <li key={item.key} className="flex justify-between gap-3"><span className="truncate">{item.key}</span><strong>{item.userCount}</strong></li>)}</ul>
      : <p className="mt-3 text-sm text-[var(--muted)]">暂无数据</p>}
  </div>;
}
