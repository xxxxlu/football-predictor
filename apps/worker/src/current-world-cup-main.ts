import { createSupplierPersistence } from "@football-predictor/db";
import { OpenLigaDbWorldCupSync, TheOddsApiClient } from "@football-predictor/supplier";
import { runCurrentWorldCupJob, validateCurrentWorldCupEnvironment } from "./current-world-cup.js";
import { createPostgresSettlementWorkerComposition } from "./settlement/composition.js";

const config = validateCurrentWorldCupEnvironment(process.env);
const persistence = createSupplierPersistence(config.databaseUrl);
const settlement = createPostgresSettlementWorkerComposition({ databaseUrl: config.databaseUrl });

try {
  const result = await runCurrentWorldCupJob({
    sync: new OpenLigaDbWorldCupSync({
      repository: persistence.repository,
      oddsClient: new TheOddsApiClient({ apiKey: config.oddsApiKey }),
    }),
    settlement,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await Promise.allSettled([persistence.close(), settlement.close()]);
}
