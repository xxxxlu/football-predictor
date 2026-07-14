import Link from "next/link";
import { BrandMark } from "./brand-mark";
import { SoccerBall } from "./football";

export function AppShell({ children, username, sessionPending = false }: { children: React.ReactNode; username?: string; sessionPending?: boolean }) {
  return <div className="min-h-screen">
    <header className="field-accent sticky top-0 z-40 border-b border-[var(--line)] bg-[rgb(244_240_230/85%)] backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 md:px-8"><BrandMark/>{sessionPending ? <span className="text-xs text-[var(--muted)]">确认会话中…</span> : username ? <nav aria-label="账户" className="flex items-center gap-3 sm:gap-4"><Link href="/rooms" className="text-sm font-bold underline-offset-4 hover:underline">进入房间</Link><Link href="/account" className="btn-volt !px-4 !py-2 text-sm">{username}</Link></nav> : <nav aria-label="账户" className="flex items-center gap-3 sm:gap-4"><Link href="/login" className="text-sm font-bold underline-offset-4 hover:underline">登录</Link><Link href="/register" className="btn-volt !px-4 !py-2 text-sm">创建账户</Link></nav>}</div>
    </header>
    {children}
    <footer className="night border-t border-[var(--night-line)] px-4 py-10 text-center text-xs leading-5 text-white/55"><span className="inline-flex items-center gap-2"><SoccerBall className="size-3.5"/>仅使用虚拟积分，不支持充值、提现或兑换。18 岁以上用户可使用。</span></footer>
  </div>;
}
