import {
  createSupplierJobHandler,
  type ClockPort,
  type MatchSnapshotRepositoryPort,
  type SupplierBudgetPort,
  type SupplierClientPort,
  type SupplierJob,
  type SupplierJobResult,
} from "./handler.js";
import { createSupplierPersistence } from "@football-predictor/db";

export interface SupplierPersistence<Fixture, Odds, Live> {
  budget: SupplierBudgetPort;
  repository: MatchSnapshotRepositoryPort<Fixture, Odds, Live>;
  close(): Promise<void>;
}

export function createSupplierWorkerComposition<Fixture, Odds, Live>(input: {
  client: SupplierClientPort<Fixture, Odds, Live>;
  persistence: SupplierPersistence<Fixture, Odds, Live>;
  clock: ClockPort;
}) {
  const handler = createSupplierJobHandler({
    client: input.client,
    budget: input.persistence.budget,
    repository: input.persistence.repository,
    clock: input.clock,
  });
  let closed = false;
  return {
    run(job: SupplierJob): Promise<SupplierJobResult> {
      if (closed) return Promise.reject(new Error("Supplier worker composition is closed"));
      return handler.run(job);
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await input.persistence.close();
    },
  };
}

export function createPostgresSupplierWorkerComposition<Fixture, Odds, Live>(input: {
  databaseUrl: string;
  client: SupplierClientPort<Fixture, Odds, Live>;
  clock: ClockPort;
  createPersistence?: (databaseUrl: string, clock: ClockPort) => SupplierPersistence<Fixture, Odds, Live>;
}) {
  const factory = input.createPersistence ?? (createSupplierPersistence as unknown as (databaseUrl: string, clock: ClockPort) => SupplierPersistence<Fixture, Odds, Live>);
  return createSupplierWorkerComposition({
    client: input.client,
    persistence: factory(input.databaseUrl, input.clock),
    clock: input.clock,
  });
}
