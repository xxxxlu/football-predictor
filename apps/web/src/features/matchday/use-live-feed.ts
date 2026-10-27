"use client";

import { useEffect, useState } from "react";
import type { LiveFeedItem } from "@pulse/domain";

export function useLiveFeed(enabled: boolean = true) {
  const [feedMap, setFeedMap] = useState<Map<string, LiveFeedItem>>(new Map());
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let isMounted = true;
    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;

    function applyItems(items: LiveFeedItem[]) {
      if (!isMounted) return;
      setFeedMap((prev) => {
        const next = new Map(prev);
        for (const item of items) {
          next.set(item.matchId, item);
        }
        return next;
      });
    }

    // Attempt Server-Sent Events first
    if (typeof window !== "undefined" && "EventSource" in window) {
      try {
        eventSource = new EventSource("/api/v1/matches/stream");

        eventSource.onopen = () => {
          if (isMounted) setIsConnected(true);
        };

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (Array.isArray(data.matches)) {
              applyItems(data.matches);
            }
          } catch {
            // ignore malformed message
          }
        };

        eventSource.onerror = () => {
          if (isMounted) setIsConnected(false);
          // Fall back to polling if stream drops
          if (!pollInterval) {
            startPolling();
          }
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    function startPolling() {
      async function poll() {
        try {
          const res = await fetch("/api/v1/matches/live-feed");
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.matches)) {
              applyItems(data.matches);
              if (isMounted) setIsConnected(true);
            }
          }
        } catch {
          if (isMounted) setIsConnected(false);
        }
      }

      poll();
      pollInterval = setInterval(poll, 6000);
    }

    return () => {
      isMounted = false;
      if (eventSource) {
        eventSource.close();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [enabled]);

  return { feedMap, isConnected };
}
