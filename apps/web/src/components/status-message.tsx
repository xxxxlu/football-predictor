type StatusMessageProps = { tone?: "error" | "success" | "info"; title: string; children?: React.ReactNode };

export function StatusMessage({ tone = "info", title, children }: StatusMessageProps) {
  const styles = tone === "error" ? "border-[var(--coral)] bg-[#fff5f1]" : tone === "success" ? "border-[var(--field)] bg-[#edf7f1]" : "border-[var(--amber)] bg-[#fff8e8]";
  const icon = tone === "error" ? "!" : tone === "success" ? "✓" : "i";
  return <div role={tone === "error" ? "alert" : "status"} className={`flex gap-3 border-l-4 p-4 text-sm ${styles}`}><span aria-hidden="true" className="font-black">{icon}</span><div><strong className="block">{title}</strong>{children && <div className="mt-1 text-[var(--muted)]">{children}</div>}</div></div>;
}
