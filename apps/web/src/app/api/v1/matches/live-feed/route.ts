import { NextResponse } from "next/server";
import { getMatchApiRuntime } from "../runtime";
import { getLiveFeedManager } from "@/features/matchday/live-feed-manager";
import type { MatchView } from "@/features/matchday/types";

export async function GET() {
  try {
    const runtime = getMatchApiRuntime();
    const result = await runtime.cache.list();
    const matches = (result.views as MatchView[]) || [];

    const manager = getLiveFeedManager();
    const feedItems = manager.processMatches(matches);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      count: feedItems.length,
      liveCount: feedItems.filter((i) => i.status === "LIVE").length,
      matches: feedItems,
    }, {
      headers: {
        "cache-control": "no-cache, no-store, must-revalidate",
        "content-type": "application/json",
      },
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "FEED_UNAVAILABLE", message: error instanceof Error ? error.message : "Failed to fetch live feed" },
      { status: 503 },
    );
  }
}
