import { getMatchApiRuntime } from "../runtime";
import { getLiveFeedManager } from "@/features/matchday/live-feed-manager";
import type { MatchView } from "@/features/matchday/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      async function sendSnapshot() {
        try {
          const runtime = getMatchApiRuntime();
          const result = await runtime.cache.list();
          const matches = (result.views as MatchView[]) || [];
          const manager = getLiveFeedManager();
          const feedItems = manager.processMatches(matches);

          const payload = JSON.stringify({
            event: "LIVE_SNAPSHOT",
            timestamp: new Date().toISOString(),
            matches: feedItems,
          });

          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // ignore transient read errors
        }
      }

      // Send immediate initial frame
      await sendSnapshot();

      // Send periodic heartbeat & updates
      const intervalId = setInterval(async () => {
        try {
          await sendSnapshot();
        } catch {
          clearInterval(intervalId);
          controller.close();
        }
      }, 5000);

      // Handle client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(intervalId);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
