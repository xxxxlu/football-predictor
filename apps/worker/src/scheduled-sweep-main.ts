import { createSupplierPersistence } from "@pulse/db";
import { OpenLigaDbCompetitionSync, TheOddsApiClient } from "@pulse/supplier";
import { runScheduledSweepJob, validateScheduledSweepEnvironment } from "./scheduled-sweep.js";
import { createPostgresSettlementWorkerComposition } from "./settlement/composition.js";

const config = validateScheduledSweepEnvironment(process.env);
const persistence = createSupplierPersistence(config.databaseUrl);
const settlement = createPostgresSettlementWorkerComposition({ databaseUrl: config.databaseUrl });

try {
  const result = await runScheduledSweepJob({
    sync: new OpenLigaDbCompetitionSync({
      repository: persistence.repository,
      oddsClient: new TheOddsApiClient({ apiKey: config.oddsApiKey }),
      competitions: config.competitions,
      ...(config.oddsSyncIntervalMs ? { oddsSyncIntervalMs: config.oddsSyncIntervalMs } : {}),
    }),
    settlement,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await Promise.allSettled([persistence.close(), settlement.close()]);
}
