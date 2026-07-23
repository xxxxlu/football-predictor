import Link from "next/link";
import { PulseLogo } from "./pulse";

export function BrandMark({ tone = "ink" }: { tone?: "ink" | "light" }) {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5 no-underline" aria-label="PULSE 首页">
      <span aria-hidden="true" className="grid place-items-center transition-transform group-hover:-translate-y-0.5">
        <PulseLogo size={30} cut={tone === "light" ? "var(--pulse-carbon)" : "var(--pulse-ivory)"} />
      </span>
      <span className="leading-none">
        <strong
          className={`block text-xl font-extrabold uppercase tracking-[.04em] ${tone === "light" ? "text-white" : ""}`}
          style={{ fontFamily: "var(--pd-font-display)" }}
        >
          PULSE
        </strong>
        <span className={`mt-0.5 block whitespace-nowrap text-[9px] font-bold tracking-[.22em] ${tone === "light" ? "text-white/55" : "text-[var(--muted)]"}`}>
          SPORTS CLUB
        </span>
      </span>
    </Link>
  );
}
