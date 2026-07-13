export type LogEntry = Readonly<Record<string, unknown>>;

export type WorkerRuntimeOptions = {
  appVersion: string;
  write: (entry: LogEntry) => void;
};

export function createWorkerRuntime({ appVersion, write }: WorkerRuntimeOptions) {
  let started = false;
  let stopped = false;

  return {
    start() {
      if (started) return;
      started = true;
      write({ event: "worker.started", appVersion, timestamp: new Date().toISOString(), outcome: "success" });
    },
    async stop(signal: NodeJS.Signals | "manual") {
      if (stopped) return;
      stopped = true;
      write({ event: "worker.stopped", signal, timestamp: new Date().toISOString(), outcome: "success" });
    },
  };
}
