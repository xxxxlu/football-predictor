type StatusMessageProps = { tone?: "error" | "success" | "info"; title: string; children?: React.ReactNode };

export function StatusMessage({ tone = "info", title, children }: StatusMessageProps) {
  const styles = tone === "error" ? "border-[var(--coral)] bg-[var(--panel-brand)]" : tone === "success" ? "border-[var(--field)] bg-[var(--wash-brand-soft)]" : "border-[var(--amber)] bg-[var(--panel-alert)]";
  const icon = tone === "error" ? "!" : tone === "success" ? "✓" : "i";
  const badge = tone === "error" ? "bg-[var(--coral)]" : tone === "success" ? "bg-[var(--field)]" : "bg-[var(--amber)]";
  return <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 rounded-xl border-l-4 p-4 text-sm ${styles}`}><span aria-hidden="true" className={`grid size-5 shrink-0 place-items-center rounded-full text-xs font-black text-white ${badge}`}>{icon}</span><div><strong className="block">{title}</strong>{children && <div className="mt-1 text-[var(--muted)]">{children}</div>}</div></div>;
}
