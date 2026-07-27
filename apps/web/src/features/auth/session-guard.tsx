"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { StatusMessage } from "@/components/status-message";
import { syncPrivateCacheOwner } from "@/features/pwa/private-cache";
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
      } else if (next.kind === "authenticated") {
        // 7.3a：私有只读缓存绑定当前账户 —— 换人登录时旧账户的缓存整体清除。
        void syncPrivateCacheOwner(next.user.id);
        if (next.user.mustChangePassword && pathname !== "/change-password") router.replace("/change-password");
      }
    });
    return () => { active = false; };
  }, [pathname, router]);

  if (session?.kind === "authenticated" && (!session.user.mustChangePassword || pathname === "/change-password")) return children;
  if (session?.kind === "unavailable") {
    // 7.3a 离线只读：离线时会话无法核验，但设备上的私有缓存只属于最后登录的账户
    // （登出/换人时已清除），所以放行只读渲染；提交面由 useOnlineStatus 统一禁用。
    if (typeof navigator !== "undefined" && !navigator.onLine) return children;
    return <main className="mx-auto max-w-3xl px-4 py-20 md:px-8"><StatusMessage tone="error" title="暂时无法确认登录状态">请检查服务连接后重试，本页面没有执行任何写操作。</StatusMessage><button type="button" onClick={() => window.location.reload()} className="mt-5 min-h-12 border border-[var(--ink)] px-5 font-bold">重新加载</button></main>;
  }
  return null;
}
