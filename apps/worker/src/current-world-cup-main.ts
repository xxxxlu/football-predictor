import { createSupplierPersistence } from "@pulse/db";
import { OpenLigaDbCompetitionSync, TheOddsApiClient } from "@pulse/supplier";
import { runCurrentWorldCupJob, validateCurrentWorldCupEnvironment } from "./current-world-cup.js";
import { createPostgresSettlementWorkerComposition } from "./settlement/composition.js";

const config = validateCurrentWorldCupEnvironment(process.env);
const persistence = createSupplierPersistence(config.databaseUrl);
const settlement = createPostgresSettlementWorkerComposition({ databaseUrl: config.databaseUrl });

try {
  const result = await runCurrentWorldCupJob({
    sync: new OpenLigaDbCompetitionSync({
      repository: persistence.repository,
      oddsClient: new TheOddsApiClient({ apiKey: config.oddsApiKey }),
      competitions: config.competitions,
    }),
    settlement,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await Promise.allSettled([persistence.close(), settlement.close()]);
}
