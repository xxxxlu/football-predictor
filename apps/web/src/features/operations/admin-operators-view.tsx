"use client";
import { FormEvent, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { GRANTABLE_ROLES, ROLE_LABELS, ROLE_SCOPES, loadOperatorRoster, setOperatorRole, type GrantableOperatorRole, type OperatorEntry, type OperatorRoster } from "./admin-operators-flow";

type Pending = { user: OperatorEntry; role: GrantableOperatorRole; granted: boolean };

export function AdminOperatorsView() {
  const [roster, setRoster] = useState<OperatorRoster>();
  const [pending, setPending] = useState<Pending>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void loadOperatorRoster().then((data) => { if (active) setRoster(data); }, (reason: unknown) => { if (active) setError((reason as Error).message || "无法加载运营人员列表"); });
    return () => { active = false; };
  }, []);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pending) return;
    setBusy(true); setError(""); setSuccess("");
    const password = String(new FormData(event.currentTarget).get("password") || "");
    try {
      const result = await setOperatorRole(fetch, { userId: pending.user.id, role: pending.role, granted: pending.granted, password });
      setRoster((current) => current && {
        ...current,
        operators: current.operators.map((operator) => operator.id !== pending.user.id ? operator : {
          ...operator,
          roles: pending.granted ? [...new Set([...operator.roles, pending.role])] : operator.roles.filter((role) => role !== pending.role),
        }),
      });
      setSuccess(result.changed
        ? `${pending.user.username} 的「${ROLE_LABELS[pending.role]}」职责已${pending.granted ? "授予" : "撤销"}，审计编号 ${result.auditId}`
        : `${pending.user.username} 的职责本来就是这样，未产生变更。`);
      setPending(undefined);
    } catch (reason) { setError((reason as Error).message || "职责变更失败"); }
    finally { setBusy(false); }
  }

  if (!roster && !error) return <DataStatePanel state="loading" title="正在加载运营人员" description=""/>;
  if (!roster) return <DataStatePanel state="error" title="运营权限暂不可用" description={error || "只有超级管理员可以管理运营职责。"}/>;

  const grantable = roster.operators.filter((operator) => !operator.isSuperAdmin && operator.status === "ACTIVE");
  const superAdmins = roster.operators.filter((operator) => operator.isSuperAdmin);

  return <div className="space-y-5">
    {success && <StatusMessage tone="success" title="职责已更新">{success}</StatusMessage>}
    {error && <StatusMessage tone="error" title="操作未完成">{error}</StatusMessage>}

    <section className="surface p-5">
      <p className="eyebrow">SUPER ADMIN</p>
      <h2 className="display mt-1 text-2xl font-bold">固定的两位超级管理员</h2>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">超级管理员由部署时的凭据配置产生，数量恒为两位，不能在后台新增、授予或撤销。受限职责也不能自己授予自己。</p>
      <ul className="mt-4 flex flex-wrap gap-2">{superAdmins.map((operator) => <li key={operator.id} className="rounded-full border-2 border-[var(--ink)] px-3 py-1 text-sm font-bold">{operator.username}</li>)}</ul>
    </section>

    <section className="surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">DUTIES</p>
          <h2 className="display mt-1 text-2xl font-bold">受限运营职责</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">每项职责只包含它需要的能力；授予与撤销都要重新确认身份，立即生效并写入审计。任何职责都不能查看密码、恢复码、会话令牌、未封盘选择或账本明细，也不能修改余额、预测与结算。</p>
        </div>
        <span className="text-xs text-[var(--muted)]">可授予 {grantable.length} 个账户</span>
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">{GRANTABLE_ROLES.map((role) => <div key={role} className="rounded-xl border border-[var(--line)] p-4">
        <dt className="font-bold">{ROLE_LABELS[role]}</dt>
        <dd className="mt-1 text-sm text-[var(--muted)]">{ROLE_SCOPES[role]}</dd>
      </div>)}</dl>

      {grantable.length === 0
        ? <p className="mt-5 text-sm text-[var(--muted)]">暂无可授予职责的启用账户。账户被禁用后不能持有运营职责。</p>
        : <ul className="mt-5 divide-y divide-[var(--line)]">{grantable.map((operator) => <li key={operator.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div>
              <strong>{operator.username}</strong>
              <p className="mt-1 text-xs text-[var(--muted)]">{operator.roles.length ? operator.roles.map((role) => ROLE_LABELS[role]).join("、") : "暂无运营职责"}</p>
            </div>
            <div className="flex flex-wrap gap-2">{GRANTABLE_ROLES.map((role) => {
              const held = operator.roles.includes(role);
              const self = operator.id === roster.actorId;
              return <button key={role} type="button" disabled={self} onClick={() => { setPending({ user: operator, role, granted: !held }); setError(""); setSuccess(""); }}
                className={`inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm font-bold transition disabled:opacity-45 ${held ? "bg-[var(--ink)] text-white hover:brightness-110" : "border-2 border-[var(--ink)] hover:bg-[var(--ink)] hover:text-white"}`}>
                {held ? `撤销${ROLE_LABELS[role]}` : `授予${ROLE_LABELS[role]}`}
              </button>;
            })}</div>
          </li>)}</ul>}
    </section>

    {pending && <section className="surface border-2 border-[var(--ink)] p-5" aria-labelledby="operator-confirm-title">
      <h2 id="operator-confirm-title" className="display text-xl font-bold">确认{pending.granted ? "授予" : "撤销"} {pending.user.username} 的「{ROLE_LABELS[pending.role]}」</h2>
      <p className="mt-2 text-sm text-[var(--muted)]">请输入当前超级管理员密码。身份确认结果最多有效 5 分钟；{pending.granted ? "授予后对方下一次请求即可使用该职责。" : "撤销后对方下一次受保护请求立即失去该职责。"}</p>
      <form onSubmit={confirm} className="mt-5 space-y-4">
        <label className="block text-sm font-bold">当前管理员密码
          <input name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={128} autoFocus className="mt-2 min-h-12 w-full rounded-lg border border-[var(--line)] px-3"/>
        </label>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--ink)] px-5 font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-50">{busy ? "正在确认…" : `确认${pending.granted ? "授予" : "撤销"}`}</button>
          <button type="button" disabled={busy} onClick={() => setPending(undefined)} className="inline-flex min-h-11 items-center justify-center rounded-full border-2 border-[var(--ink)] px-5 font-bold transition hover:bg-[var(--ink)] hover:text-white">取消</button>
        </div>
      </form>
    </section>}
  </div>;
}
