"use client";
import { useEffect, useRef, useState } from "react";
import { registerServiceWorker } from "./service-worker-registration";

export function ServiceWorkerRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker>(); const [dismissed, setDismissed] = useState(false); const reloading = useRef(false);
  useEffect(() => {
    let registration: ServiceWorkerRegistration | null = null;
    const onControllerChange = () => { if (reloading.current) return; reloading.current = true; window.location.reload(); };
    const updateWhenVisible = () => { if (document.visibilityState === "visible" && registration) void registration.update(); };
    navigator.serviceWorker?.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", updateWhenVisible);
    void registerServiceWorker(setWaiting).then((value) => { registration = value; }).catch(() => { /*安装能力不是核心流程，不用错误提示打断用户。*/ });
    return () => { navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange); document.removeEventListener("visibilitychange", updateWhenVisible); };
  }, []);
  if (!waiting || dismissed) return null;
  return <aside role="status" aria-live="polite" aria-labelledby="pwa-update-title" className="fixed inset-x-3 bottom-12 z-50 mx-auto max-w-xl border border-[var(--ink)] bg-[var(--paper-raised)] p-4 shadow-[var(--shadow)] motion-safe:transition-opacity sm:bottom-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex-1"><h2 id="pwa-update-title" className="font-bold">新版本已准备好</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">更新会重新加载页面，不会重放预测或其他写操作。</p></div><div className="flex gap-2"><button type="button" onClick={() => setDismissed(true)} className="min-h-10 border border-[var(--line)] px-3 text-sm font-bold">稍后</button><button type="button" onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })} className="min-h-10 bg-[var(--field)] px-3 text-sm font-bold text-white">立即更新</button></div></div></aside>;
}
