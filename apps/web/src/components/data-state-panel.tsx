import { SoccerBall, Whistle, ShieldLock } from "./football";

function FixtureSkeleton() {
  return (
    <div className="surface rounded-xl p-4">
      <div className="pitch-skeleton h-4 w-24 rounded-full" />
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex flex-col items-center gap-2">
          <div className="pitch-skeleton size-12 rounded-full" />
          <div className="pitch-skeleton h-3 w-16 rounded-full" />
        </div>
        <div className="pitch-skeleton size-8 rounded-full" />
        <div className="flex flex-col items-center gap-2">
          <div className="pitch-skeleton size-12 rounded-full" />
          <div className="pitch-skeleton h-3 w-16 rounded-full" />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <div className="pitch-skeleton h-12 rounded-xl" />
        <div className="pitch-skeleton h-12 rounded-xl" />
        <div className="pitch-skeleton h-12 rounded-xl" />
      </div>
    </div>
  );
}

export function DataStatePanel({ state, title, description, action }: { state: "loading" | "empty" | "error" | "forbidden"; title: string; description: string; action?: React.ReactNode }) {
  if (state === "loading") {
    return (
      <div aria-live="polite" aria-busy="true" className="grid gap-3 sm:grid-cols-2">
        <FixtureSkeleton />
        <FixtureSkeleton />
        <span className="sr-only">{title}</span>
      </div>
    );
  }
  const icon = state === "forbidden"
    ? <ShieldLock className="size-6 text-[var(--muted)]" />
    : state === "error"
      ? <Whistle className="size-6 text-[var(--coral)]" />
      : <SoccerBall className="size-8" />;
  return (
    <section role={state === "error" ? "alert" : "status"} className="surface rounded-xl p-8 text-center">
      <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-full" style={{ background: "rgb(23 107 77 / 8%)" }}>
        {icon}
      </span>
      <h2 className="display mt-4 text-2xl font-bold">{title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-[var(--muted)]">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </section>
  );
}
