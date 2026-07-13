import { describe, expect, it, vi } from "vitest";
import { createWorkerRuntime } from "./runtime.js";

describe("worker runtime", () => {
  it("logs structured lifecycle events and shuts down idempotently", async () => {
    const write = vi.fn();
    const runtime = createWorkerRuntime({ appVersion: "1.0.0", write });
    runtime.start();
    await runtime.stop("SIGTERM");
    await runtime.stop("SIGTERM");
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0]?.[0]).toMatchObject({ event: "worker.started", appVersion: "1.0.0" });
    expect(write.mock.calls[1]?.[0]).toMatchObject({ event: "worker.stopped", signal: "SIGTERM" });
  });
});
