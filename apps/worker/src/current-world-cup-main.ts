import { createSupplierPersistence } from "@football-predictor/db";
import { OpenLigaDbWorldCupSync, TheOddsApiClient } from "@football-predictor/supplier";
import { validateCurrentWorldCupEnvironment } from "./current-world-cup.js";

const config = validateCurrentWorldCupEnvironment(process.env);
const persistence = createSupplierPersistence(config.databaseUrl);

try {
  const result = await new OpenLigaDbWorldCupSync({
    repository: persistence.repository,
    oddsClient: new TheOddsApiClient({ apiKey: config.oddsApiKey }),
  }).run();
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await persistence.close();
}
