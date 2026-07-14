import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { LegalBoundary } from "@/components/legal-boundary";
import { OfflineReadonlyNotice } from "@/components/offline-readonly-notice";
import { TermsSection } from "@/components/terms-section";

export const metadata: Metadata = { title: "使用规则与隐私说明", description: "看球账本的 18+、非现金、隐私和体育数据使用边界。" };

export default function TermsPage() {
  return <div className="min-h-screen"><header className="border-b rule"><div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-8"><BrandMark/><Link href="/" className="text-sm font-bold hover:underline">返回首页</Link></div></header><main id="main-content" className="mx-auto max-w-4xl px-4 py-10 sm:px-8 sm:py-16"><p className="eyebrow">使用规则 · Phase 1</p><h1 className="display mt-3 text-4xl font-bold sm:text-5xl">先说清边界，再开始比赛日</h1><p className="mt-4 max-w-2xl leading-7 text-[var(--muted)]">本页说明产品的基本使用规则与隐私原则。创建账户，以及创建或加入房间时，系统会记录你确认的规则版本和时间。</p><div className="mt-8"><LegalBoundary/></div><div className="mt-10">
    <TermsSection number="01" title="资格与账户"><p>你必须年满 18 岁，并使用自己的账户。用户名和密码由你保管；注册后生成的恢复码仅展示一次。使用恢复码后，旧恢复码与既有会话会失效。</p><p>不得冒用他人身份、绕过访问限制、自动化滥用接口或干扰其他成员正常使用。</p></TermsSection>
    <TermsSection number="02" title="私人房间"><p>私人房间通过邀请加入。房主可以管理邀请和房间，但不能查看成员密码、恢复码，也不能在封盘前查看成员的具体选择与投入。</p><p>重置邀请只会使旧链接失效，不会删除已有成员、积分、预测或账本记录。涉嫌用于真钱活动的房间可能被限制或关闭。</p></TermsSection>
    <TermsSection number="03" title="虚拟积分与账本"><p>每个房间的积分账户相互独立，初始值为 10,000 分。预测提交后，可用积分转为冻结积分；失败请求不得改变余额。单张预测投入上限为 20,000 分。</p><p>结算、更正和冲正采用追加式账本保留历史。显示的预计返还不是现金承诺，也不能兑换任何有价物。</p></TermsSection>
    <TermsSection number="04" title="比赛数据与封盘"><p>比赛时间和状态来自公开体育数据来源或其产品缓存；积分倍率由平台规则提供，可能延迟、暂停或被更正。服务端以实际开球、最新可用积分倍率、数据新鲜度和封盘状态作为最终提交依据。</p><p>数据不可验证或已过期时，系统会暂停提交。球队名称、赛事名称、统计数据及相关标识的权利归各自权利人所有；产品不因此主张所有权。</p></TermsSection>
    <TermsSection number="05" title="隐私与安全"><p>Phase 1 注册不要求手机号或邮箱。系统仅处理提供服务、安全防护和审计所必需的账户、房间、预测、账本、设备会话与安全事件数据。</p><p>密码、恢复码和会话凭证不会以明文写入日志。普通用户只能访问其所在私人房间的数据；管理员受角色权限和审计约束。</p><p>账户删除请求会撤销访问凭证，并按账本完整性、反滥用与合规需要删除或匿名化相关数据。</p></TermsSection>
    <TermsSection number="06" title="公平使用与可用性"><p>不得利用数据延迟、并发请求、重复请求或技术故障获得不当优势。系统可拒绝重复、已封盘、余额不足或数据不可用的提交。</p><p>服务可能因维护、供应商额度、网络或不可抗力暂时不可用。中断期间不会将离线操作自动当作有效预测。</p></TermsSection>
  </div><OfflineReadonlyNotice/><p className="mt-8 text-xs leading-5 text-[var(--muted)]">规则版本：Phase 1 / 2026-07-13。规则更新后，执行下一次受保护写操作前可能需要重新确认。</p></main></div>;
}
