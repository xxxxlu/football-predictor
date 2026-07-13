export function DataStatePanel({ state, title, description, action }: { state: "loading" | "empty" | "error" | "forbidden"; title: string; description: string; action?: React.ReactNode }) {
  if (state === "loading") return <div aria-live="polite" aria-busy="true" className="space-y-3"><div className="surface h-20 animate-pulse bg-white/45"/><div className="surface h-20 animate-pulse bg-white/45"/><span className="sr-only">{title}</span></div>;
  const mark = state === "forbidden" ? "锁" : state === "error" ? "!" : "—";
  return <section role={state === "error" ? "alert" : "status"} className="surface p-8 text-center"><span aria-hidden="true" className="mx-auto grid size-10 place-items-center border border-[var(--line)] font-bold text-[var(--muted)]">{mark}</span><h2 className="display mt-4 text-2xl font-bold">{title}</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">{description}</p>{action && <div className="mt-5">{action}</div>}</section>;
}
