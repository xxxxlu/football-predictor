import { ApiFootballClient } from "@football-predictor/api-football";
import { ConfigError, loadSupplierWorkerConfig } from "@football-predictor/config";
import { createSupplierPersistence } from "@football-predictor/db";
import { createSupplierWorkerComposition } from "./supplier/composition.js";
import { PrewarmConfigurationError, runSupplierPrewarm, validatePrewarmEnvironment } from "./supplier/prewarm.js";

const write = (stream: NodeJS.WriteStream, entry: Readonly<Record<string, unknown>>) => stream.write(`${JSON.stringify(entry)}\n`);

async function main() {
  validatePrewarmEnvironment(process.env);
  const config = loadSupplierWorkerConfig(process.env);
  const clock = { now: () => new Date() };
  const persistence = createSupplierPersistence(config.databaseUrl, clock);
  const supplier = createSupplierWorkerComposition({
    client: new ApiFootballClient({ apiKey: config.apiFootballKey, baseUrl: config.apiFootballBaseUrl, now: clock.now }),
    persistence, clock,
  });
  const result = await runSupplierPrewarm({ competitions: config.competitions, bookmakerId: config.bookmakerId, pastDays: config.pastDays, futureDays: config.futureDays, ...(config.referenceDate ? { referenceDate: new Date(`${config.referenceDate}T00:00:00Z`) } : {}), clock, supplier, fixtures: persistence.repository, budget: persistence.budget });
  write(process.stdout, { event: "supplier.prewarm.completed", outcome: "success", ...result });
}

void main().catch((error: unknown) => {
  const message = error instanceof PrewarmConfigurationError || error instanceof ConfigError
    ? error.message
    : "Supplier prewarm failed. Check database connectivity, API-FOOTBALL access, configured competitions, and daily request budget.";
  write(process.stderr, { event: "supplier.prewarm.failed", outcome: "failure", error: error instanceof Error ? error.name : "UnknownError", message });
  process.exitCode = 1;
});
