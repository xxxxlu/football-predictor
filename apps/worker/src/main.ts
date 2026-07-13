import { ApiFootballClient } from "@football-predictor/api-football";
import { loadServerConfig, loadSupplierWorkerConfig } from "@football-predictor/config";
import { createSupplierPersistence } from "@football-predictor/db";
import { createWorkerRuntime, type LogEntry } from "./runtime.js";
import { createWorkerScheduler } from "./scheduler.js";
import { createPostgresSettlementWorkerComposition } from "./settlement/composition.js";
import { createSupplierWorkerComposition } from "./supplier/composition.js";

const write = (entry: LogEntry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const clock = { now: () => new Date() };

async function main() {
  const serverConfig = loadServerConfig(process.env);
  const workerConfig = loadSupplierWorkerConfig(process.env);
  const runtime = createWorkerRuntime({ appVersion: serverConfig.appVersion, write });
  const persistence = createSupplierPersistence(workerConfig.databaseUrl, clock);
  const supplier = createSupplierWorkerComposition({
    client: new ApiFootballClient({
      apiKey: workerConfig.apiFootballKey,
      baseUrl: workerConfig.apiFootballBaseUrl,
      now: clock.now,
    }),
    persistence,
    clock,
  });
  const settlement = createPostgresSettlementWorkerComposition({ databaseUrl: workerConfig.databaseUrl, clock });
  const scheduler = createWorkerScheduler({
    config: workerConfig,
    clock,
    timers: {
      setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
      clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
    },
    supplier,
    settlement,
    fixtures: persistence.repository,
    write,
  });

  try {
    await scheduler.start();
    runtime.start();
  } catch (error) {
    await scheduler.stop();
    throw error;
  }

  let shutdown: Promise<void> | undefined;
  const stop = (signal: NodeJS.Signals) => {
    shutdown ??= (async () => {
      await scheduler.stop();
      await runtime.stop(signal);
    })();
    void shutdown.then(() => { process.exitCode = 0; });
  };
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => stop(signal));
}

void main().catch((error: unknown) => {
  write({
    event: "worker.start_failed",
    timestamp: new Date().toISOString(),
    outcome: "failure",
    error: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
