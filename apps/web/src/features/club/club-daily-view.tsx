"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { useLocale } from "@/components/locale-provider";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import {
  attemptFeedback,
  badgeLabel,
  buildFortuneShareText,
  clubErrorKey,
  localizeText,
  type DailyAttemptPayload,
  type DailyPayload,
  type DailyResultRowPayload,
  type DailyResultsPayload,
  type EngagementPayload,
} from "./club-daily-flow";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...(init?.method && init.method !== "GET" ? { headers: { "Content-Type": "application/json" }, ...init } : init),
  });
  const result = (await response.json().catch(() => ({}))) as ApiEnvelope<T> & ApiFailure;
  if (!response.ok) throw Object.assign(new Error(result.error?.message || ""), { code: result.error?.code });
  return result.data;
}

function ResultList({ rows, title }: { rows: DailyResultRowPayload[]; title: string }) {
  const { locale, t } = useLocale();
  void locale;
  if (rows.length === 0) return null;
  return <div className="mt-4">
    <h3 className="text-sm font-bold">{title}</h3>
    <ul className="mt-2 divide-y divide-[var(--line)]">
      {rows.map((row) => <li key={row.pulseId} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
        <span className="font-bold">{row.nickname || row.pulseId}</span>
        <span className="text-xs text-[var(--muted)]">NO. {row.pulseId}</span>
        <span className="ml-auto flex items-center gap-3">
          {row.answered
            ? <span className="font-bold">{row.correct ? "✓ " : "✗ "}{row.correct ? t("club.daily.correct") : t("club.daily.wrong")}</span>
            : <span className="text-[var(--muted)]">{t("club.daily.notAnswered")}</span>}
          {row.streak > 0 && <span className="text-xs text-[var(--muted)]">{t("club.daily.streak")} {row.streak}</span>}
        </span>
      </li>)}
    </ul>
  </div>;
}

export function ClubDailyView() {
  const { locale, t } = useLocale();
  const [daily, setDaily] = useState<DailyPayload>();
  const [results, setResults] = useState<DailyResultsPayload>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<"A" | "B" | "C" | "D" | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");
  const [newBadges, setNewBadges] = useState<string[]>([]);
  const [fortuneRevealed, setFortuneRevealed] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");

  const loadResults = useCallback(async (signal?: AbortSignal) => {
    setResults(await api<DailyResultsPayload>("/api/v1/club/daily/results", { signal }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const payload = await api<DailyPayload>("/api/v1/club/daily", { signal: controller.signal });
        setDaily(payload);
        await loadResults(controller.signal);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setLoadError(t(clubErrorKey((reason as { code?: string }).code)));
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadResults]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!daily || daily.attempt) return;
    if (!selected) { setActionError(t("club.daily.selectFirst")); return; }
    setSubmitting(true);
    setActionError("");
    try {
      const result = await api<{ attempt: DailyAttemptPayload; profile: EngagementPayload; newBadges: string[] }>(
        "/api/v1/club/daily/attempt",
        { method: "POST", body: JSON.stringify({ answer: selected }) },
      );
      setDaily({ ...daily, attempt: result.attempt, profile: result.profile, badges: [...new Set([...daily.badges, ...result.newBadges])] });
      setNewBadges(result.newBadges);
      await loadResults().catch(() => {});
    } catch (reason) {
      setActionError(t(clubErrorKey((reason as { code?: string }).code)));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyFortune() {
    if (!daily) return;
    try {
      await navigator.clipboard.writeText(buildFortuneShareText(daily.fortune, locale));
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
  }

  if (loading) return <DataStatePanel state="loading" title={t("club.daily.loading")} description="" />;
  if (!daily) return <DataStatePanel state="error" title={t("club.daily.unavailable")} description={loadError} />;

  const feedback = daily.attempt ? attemptFeedback(daily.attempt) : null;

  return <div className="space-y-6">
    {actionError && <StatusMessage tone="error" title={actionError} />}

    <div className="grid gap-5 lg:grid-cols-[1fr_.8fr]">
      <div className="space-y-5">
        <section className="surface p-5 sm:p-7" aria-label={t("club.daily.questionTitle")}>
          <p className="eyebrow">DAILY CHALLENGE / {daily.day}</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("club.daily.questionTitle")}</h2>
          <p className="mt-3 text-base font-bold leading-7">{localizeText(daily.question.prompt, locale)}</p>

          {!daily.attempt && <form onSubmit={submit} className="mt-5">
            <fieldset>
              <legend className="sr-only">{localizeText(daily.question.prompt, locale)}</legend>
              <div className="space-y-2.5">
                {daily.question.options.map((option) => <label key={option.key}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-2 transition ${selected === option.key ? "border-[var(--ink)] bg-[var(--ink)]/5 font-bold" : "border-[var(--line)] bg-white"}`}>
                  <input type="radio" name="daily-answer" value={option.key} checked={selected === option.key}
                    onChange={() => setSelected(option.key)} className="h-5 w-5" />
                  <span><b className="mr-2">{option.key}.</b>{localizeText(option.text, locale)}</span>
                </label>)}
              </div>
            </fieldset>
            <button disabled={submitting} className="mt-5 inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--field)] px-6 font-bold text-white transition hover:brightness-95 disabled:opacity-45">
              {submitting ? t("club.daily.submitting") : t("club.daily.submit")}
            </button>
          </form>}

          {/* aria-live: the verdict is announced when it appears; text + symbol, never color alone. */}
          <div aria-live="polite">
            {daily.attempt && feedback && <div className="mt-5 space-y-3">
              <StatusMessage tone={feedback.tone} title={`${feedback.symbol} ${t(feedback.messageKey)}`}>
                {t("club.daily.yourAnswer")}: {daily.attempt.answer} · {t("club.daily.xpGained")} +{daily.attempt.xpAwarded} · {t("club.daily.streak")} {daily.attempt.streakAfter}
              </StatusMessage>
              {newBadges.length > 0 && <p className="text-sm font-bold">{t("club.daily.newBadge")}: {newBadges.map((badge) => badgeLabel(badge, locale)).join(" / ")}</p>}
              <p className="text-sm text-[var(--muted)]">{t("club.daily.answeredToday")} — {t("club.daily.comeBack")}</p>
            </div>}
          </div>
        </section>

        <section className="surface p-5 sm:p-7" aria-label={t("club.daily.resultsTitle")}>
          <p className="eyebrow">RESULTS</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("club.daily.resultsTitle")}</h2>
          {!results || results.locked
            ? <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t("club.daily.resultsLocked")}</p>
            : results.friends.length === 0 && (!results.room || results.room.length === 0)
              ? <p className="mt-4 text-sm text-[var(--muted)]">{t("club.daily.resultsEmpty")}</p>
              : <>
                <ResultList rows={results.friends} title="FRIENDS" />
                {results.room && <ResultList rows={results.room} title="ROOM" />}
              </>}
        </section>
      </div>

      <div className="space-y-5">
        <section className="surface p-5 sm:p-7" aria-label={t("club.daily.fortuneTitle")}>
          <p className="eyebrow">FORTUNE</p>
          <h2 className="display mt-1 text-2xl font-bold">{t("club.daily.fortuneTitle")}</h2>
          {!fortuneRevealed
            ? <button type="button" onClick={() => setFortuneRevealed(true)}
                className="mt-5 flex min-h-36 w-full items-center justify-center rounded-2xl border-2 border-dashed border-[var(--line)] font-bold transition hover:border-[var(--ink)]">
                {t("club.daily.fortuneReveal")}
              </button>
            : <div className="mt-5 rounded-2xl border border-[var(--line)] bg-white p-5" aria-live="polite">
                <p className="display text-xl font-bold">{localizeText(daily.fortune.title, locale)}</p>
                <p className="mt-3 text-sm leading-7">{localizeText(daily.fortune.text, locale)}</p>
                <button type="button" onClick={() => void copyFortune()}
                  className="mt-5 min-h-11 w-full rounded-full border-2 border-[var(--ink)] px-4 font-bold transition hover:bg-[var(--ink)] hover:text-white">
                  {shareState === "copied" ? t("club.daily.fortuneShared") : t("club.daily.fortuneShare")}
                </button>
                {shareState === "failed" && <p className="mt-2 text-xs font-bold text-[var(--coral)]">{t("club.daily.fortuneShareFailed")}</p>}
              </div>}
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{t("club.daily.fortuneDisclaimer")}</p>
        </section>

        <section className="surface p-5 sm:p-7" aria-label={t("club.daily.badges")}>
          <p className="eyebrow">CLUB RECORD</p>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div><dt className="text-xs text-[var(--muted)]">{t("club.daily.xpTotal")}</dt><dd className="display mt-1 text-2xl font-bold">{daily.profile.xpTotal}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">{t("club.daily.streak")}</dt><dd className="display mt-1 text-2xl font-bold">{daily.profile.currentStreak}</dd></div>
            <div><dt className="text-xs text-[var(--muted)]">{t("club.daily.bestStreak")}</dt><dd className="display mt-1 text-2xl font-bold">{daily.profile.bestStreak}</dd></div>
          </dl>
          <h3 className="mt-5 text-sm font-bold">{t("club.daily.badges")}</h3>
          {daily.badges.length === 0
            ? <p className="mt-2 text-sm text-[var(--muted)]">—</p>
            : <ul className="mt-2 flex flex-wrap gap-2">
              {daily.badges.map((badge) => <li key={badge} className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-bold">{badgeLabel(badge, locale)}</li>)}
            </ul>}
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">{t("club.daily.xpNote")}</p>
        </section>
      </div>
    </div>
  </div>;
}
