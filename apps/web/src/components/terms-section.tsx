export function TermsSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <section className="grid gap-3 border-t rule py-7 sm:grid-cols-[3rem_1fr]"><span aria-hidden="true" className="tabular text-xs font-bold text-[var(--field)]">{number}</span><div><h2 className="display text-2xl font-bold">{title}</h2><div className="mt-3 space-y-3 text-sm leading-7 text-[var(--muted)]">{children}</div></div></section>;
}
