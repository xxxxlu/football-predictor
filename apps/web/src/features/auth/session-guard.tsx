"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { StatusMessage } from "@/components/status-message";
import { loginHref } from "./navigation";
import { loadSession, type SessionState } from "./session-client";

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionState>();

  useEffect(() => {
    let active = true;
    void loadSession().then((next) => {
      if (!active) return;
      setSession(next);
      if (next.kind === "anonymous") {
        router.replace(loginHref(`${pathname}${window.location.search}`));
      } else if (next.kind === "authenticated" && next.user.mustChangePassword && pathname !== "/change-password") {
        router.replace("/change-password");
      }
    });
    return () => { active = false; };
  }, [pathname, router]);

  if (session?.kind === "authenticated" && (!session.user.mustChangePassword || pathname === "/change-password")) return children;
  if (session?.kind === "unavailable") return <main className="mx-auto max-w-3xl px-4 py-20 md:px-8"><StatusMessage tone="error" title="暂时无法确认登录状态">请检查服务连接后重试，本页面没有执行任何写操作。</StatusMessage><button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-12 border border-[var(--ink)] px-5 font-bold">重新加载</button></main>;
  return <main className="mx-auto max-w-3xl px-4 py-20 md:px-8" aria-busy="true"><p className="eyebrow">正在确认会话</p><div className="mt-4 h-24 animate-pulse bg-black/5"/></main>;
}
