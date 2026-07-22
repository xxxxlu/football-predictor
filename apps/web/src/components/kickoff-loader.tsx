/** Full-screen branded intro loader (carbon + PULSE LINE draw), shown while the session resolves. */
export function KickoffLoader() {
  return (
    <div className="kickoff" role="status" aria-label="加载中">
      <div className="flex flex-col items-center gap-7 px-6 text-center">
        <span className="kinetic text-[clamp(2.75rem,11vw,6.5rem)] leading-none">
          PUL<span className="text-stroke text-[var(--pulse-red)]">SE</span>
        </span>
        <svg width="120" height="30" viewBox="0 0 144 52" aria-hidden="true">
          <path
            d="M6 46 L36 46 C56 46 56 6 76 6 L108 6 C120 6 120 26 138 26"
            fill="none"
            stroke="var(--pulse-red)"
            strokeWidth="4"
            strokeLinecap="round"
            className="pd-loader-line"
          />
        </svg>
      </div>
    </div>
  );
}
