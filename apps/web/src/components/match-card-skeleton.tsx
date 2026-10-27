/**
 * 1:1 MatchCardSkeleton to eliminate layout shifts (CLS) and rough block jumps.
 * Matches exact geometry of MatchCard: header league/status, 3-column team matchup, and 3 odds cells.
 */
export function MatchCardSkeleton() {
  return (
    <article aria-hidden="true" className="surface field-accent overflow-hidden rounded-xl border border-white/5 animate-pulse">
      <header className="flex items-center justify-between gap-3 border-b rule px-4 py-3">
        <div className="h-5 w-28 rounded bg-[var(--wash-neutral)]" />
        <div className="h-4 w-14 rounded-full bg-[var(--wash-neutral)]" />
      </header>
      <div className="p-4 md:p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
          {/* Home team */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="size-12 rounded-full bg-[var(--wash-neutral)] md:size-14" />
            <div className="h-4 w-20 rounded bg-[var(--wash-neutral)]" />
          </div>
          {/* VS & Time */}
          <div className="flex flex-col items-center gap-2 pt-1.5">
            <div className="size-8 rounded-full bg-[var(--wash-neutral)]" />
            <div className="h-3 w-16 rounded bg-[var(--wash-neutral)]" />
          </div>
          {/* Away team */}
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="size-12 rounded-full bg-[var(--wash-neutral)] md:size-14" />
            <div className="h-4 w-20 rounded bg-[var(--wash-neutral)]" />
          </div>
        </div>

        {/* 3 Odds buttons skeleton */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="h-14 rounded-lg bg-[var(--wash-neutral)]" />
          <div className="h-14 rounded-lg bg-[var(--wash-neutral)]" />
          <div className="h-14 rounded-lg bg-[var(--wash-neutral)]" />
        </div>

        {/* Action placeholder */}
        <div className="mt-4 flex items-center justify-between pt-2">
          <div className="h-4 w-24 rounded bg-[var(--wash-neutral)]" />
          <div className="h-4 w-4 rounded bg-[var(--wash-neutral)]" />
        </div>
      </div>
    </article>
  );
}
