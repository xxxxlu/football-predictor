import { loadServerConfig } from "@football-predictor/config";
import { createWorkerRuntime, type LogEntry } from "./runtime.js";

const config = loadServerConfig(process.env);
const write = (entry: LogEntry) => process.stdout.write(`${JSON.stringify(entry)}\n`);
const runtime = createWorkerRuntime({ appVersion: config.appVersion, write });
runtime.start();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void runtime.stop(signal).finally(() => process.exit(0));
  });
}
