"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DataStatePanel } from "@/components/data-state-panel";
import { StatusMessage } from "@/components/status-message";
import { TeamCrest } from "@/components/football";
import { useLocale } from "@/components/locale-provider";
import type { ApiEnvelope, ApiFailure } from "@/features/matchday/types";
import { publicRoomJoinRequest, type PublicRoomSummaryRecord } from "./room-flow";

/**
 * The public-room discovery block, extracted from RoomListView (Story 12.4) so
 * the PULSE CLUB lobby reuses the exact same section instead of rewriting it.
 * Self-contained: it fetches `GET /api/v1/rooms/public` and runs the join flow
 * itself, so a host page adds discovery with one element. Fully localized —
 * it renders inside the bilingual /club lobby.
 */
type LobbyPage = { rooms: PublicRoomSummaryRecord[]; cursor: string | null };

/** The lobby is paged (Story P0-2): an unpaged read grew with every public room
 *  ever opened. A response without `rooms` is treated as an empty page rather
 *  than a crash, so an older server shape degrades instead of blanking the page. */
async function fetchLobbyPage(cursor: string | null, signal: AbortSignal | undefined, t: (key: "rooms.public.loadFailed") => string): Promise<LobbyPage> {
  const url = cursor ? `/api/v1/rooms/public?cursor=${encodeURIComponent(cursor)}` : "/api/v1/rooms/public";
  const response = await fetch(url, { credentials: "same-origin", signal });
  const lobby = await response.json().catch(() => ({})) as ApiEnvelope<LobbyPage> & ApiFailure;
  if (!response.ok) throw new Error(t("rooms.public.loadFailed"));
  return { rooms: Array.isArray(lobby.data?.rooms) ? lobby.data.rooms : [], cursor: lobby.data?.cursor ?? null };
}

export function PublicRoomsSection({ headingId = "public-rooms-title" }: { headingId?: string }) {
  const router = useRouter();
  const { t } = useLocale();
  const [publicRooms, setPublicRooms] = useState<PublicRoomSummaryRecord[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [joiningRoomId, setJoiningRoomId] = useState("");
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const page = await fetchLobbyPage(null, controller.signal, t);
        setPublicRooms(page.rooms);
        setCursor(page.cursor);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") {
          // A network TypeError carries browser English — fold to the localized generic.
          setLoadError(reason instanceof TypeError ? t("rooms.public.loadFailed") : (reason as Error).message || t("rooms.public.loadFailed"));
        }
      } finally {
        setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [t]);

  /** Appends the next page. A failure here leaves the pages already on screen
   *  alone and surfaces above the list, so "more failed" never reads as "empty". */
  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true); setLoadError("");
    try {
      const page = await fetchLobbyPage(cursor, undefined, t);
      // Key on id: a room created between two page reads can otherwise arrive twice.
      setPublicRooms((current) => {
        const seen = new Set(current.map((room) => room.id));
        return [...current, ...page.rooms.filter((room) => !seen.has(room.id))];
      });
      setCursor(page.cursor);
    } catch (reason) {
      setLoadError(reason instanceof TypeError ? t("rooms.public.loadFailed") : (reason as Error).message || t("rooms.public.loadFailed"));
    } finally {
      setLoadingMore(false);
    }
  }

  async function joinPublic(roomId: string) {
    if (!window.confirm(t("rooms.public.joinConfirm"))) return;
    setJoiningRoomId(roomId); setJoinError("");
    const request = publicRoomJoinRequest(roomId);
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({})) as ApiEnvelope<{ roomId: string }> & ApiFailure;
      if (!response.ok) throw new Error(t("rooms.public.joinError"));
      router.push(`/rooms/${encodeURIComponent(result.data.roomId)}`);
    } catch (reason) {
      setJoinError((reason as Error).message || t("rooms.public.joinError"));
    } finally {
      setJoiningRoomId("");
    }
  }

  const sportLabel = (sport: PublicRoomSummaryRecord["sport"]) =>
    sport === "FORMULA_1" ? t("rooms.sport.FORMULA_1") : t("rooms.sport.FOOTBALL");

  return <section aria-labelledby={headingId}>
    <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--field)]">{t("rooms.public.eyebrow")}</p><h2 id={headingId} className="kinetic mt-1 text-3xl">{t("rooms.public.title")}</h2></div>{/* A trailing "+" while a cursor remains: this is what has been loaded, never a total. */}
<span className="league-pill shrink-0">{publicRooms.length}{cursor ? "+" : ""} {t("rooms.public.countUnit")}</span></div>
    {joinError && <div className="mb-4"><StatusMessage tone="error" title={t("rooms.public.joinFailedTitle")}>{joinError}</StatusMessage></div>}
    {loading
      ? <DataStatePanel state="loading" title={t("rooms.public.loading")} description=""/>
      : loadError
        ? <DataStatePanel state="error" title={t("rooms.public.loadErrorTitle")} description={loadError}/>
        : publicRooms.length
          ? <ul className="grid gap-4 sm:grid-cols-2">{publicRooms.map((room) => <li key={room.id} className="surface rounded-xl p-5"><div className="flex items-start justify-between gap-3"><TeamCrest name={room.name} className="size-12 text-base"/><span className="league-pill">{sportLabel(room.sport ?? "FOOTBALL")} · {t("rooms.public.publicTag")}</span></div><strong className="mt-4 block text-lg font-black">{room.name}</strong><p className="mt-1 text-xs text-[var(--muted)]">{t("rooms.public.owner")} {room.ownerName} · {room.memberCount} {t("rooms.public.memberUnit")}</p>{room.joined ? <Link href={`/rooms/${encodeURIComponent(room.id)}`} className="mt-4 inline-flex min-h-10 w-full items-center justify-center rounded-full bg-[var(--field)] px-4 text-sm font-bold text-white no-underline">{t("rooms.public.enter")}</Link> : <button type="button" disabled={joiningRoomId === room.id} onClick={() => joinPublic(room.id)} className="mt-4 min-h-10 w-full rounded-full bg-[var(--ink)] px-4 text-sm font-bold text-white transition hover:bg-[var(--field)] disabled:opacity-55">{joiningRoomId === room.id ? t("rooms.public.joining") : t("rooms.public.join")}</button>}</li>)}</ul>
          : <DataStatePanel state="empty" title={t("rooms.public.emptyTitle")} description={t("rooms.public.emptyBody")}/>}
    {!loading && cursor && <div className="mt-5 flex justify-center"><button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="min-h-10 rounded-full border border-[var(--ink)] px-6 text-sm font-bold transition hover:bg-[var(--ink)] hover:text-white disabled:opacity-55">{loadingMore ? t("rooms.public.loadingMore") : t("rooms.public.loadMore")}</button></div>}
  </section>;
}
