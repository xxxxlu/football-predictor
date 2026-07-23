import { z } from "zod";

/** F1 API contracts (§12.4–12.5). Selection grammars mirror domain/f1/selections.ts;
 *  the domain remains the authority on candidate sets and settlement. */

export const f1SessionKindSchema = z.enum(["QUALIFYING", "SPRINT_QUALIFYING", "SPRINT", "GRAND_PRIX"]);
export const f1SessionStateSchema = z.enum(["UPCOMING", "LOCKED", "FINISHED", "CANCELLED"]);
export const f1MarketKindSchema = z.enum(["POLE", "WINNER", "PODIUM", "EXACT_PODIUM", "H2H"]);
export const f1ClassificationStatusSchema = z.enum(["FINISHED", "DNF", "DNS", "DSQ"]);

export const f1DriverCodeSchema = z.string().regex(/^[A-Z][A-Z0-9]{1,3}$/, "FIA-style driver code");

const DRIVER = "[A-Z][A-Z0-9]{1,3}";
export const f1SelectionStringSchema = z.string().regex(
  new RegExp(`^(DRV:${DRIVER}|PODIUM:${DRIVER}:(YES|NO)|POD3:${DRIVER}-${DRIVER}-${DRIVER}|H2H:${DRIVER}>${DRIVER})$`),
  "encoded F1 selection",
);

export const f1MarketIdSchema = z.string().regex(/^f1:.+:(POLE|WINNER|PODIUM|EXACT_PODIUM|H2H)$/);

const decimalOddsSchema = z.string().regex(/^\d+\.\d{2}$/);

export const f1ConstructorSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const f1DriverSchema = z.object({
  code: f1DriverCodeSchema,
  number: z.number().int().min(1),
  name: z.string().min(1),
  constructorKey: z.string().min(1),
  active: z.boolean(),
});

export const f1SessionSchema = z.object({
  id: z.uuid(),
  weekendId: z.uuid(),
  kind: f1SessionKindSchema,
  startsAt: z.iso.datetime(),
  state: f1SessionStateSchema,
  resultVersion: z.number().int().min(1).nullable(),
  resultConfirmed: z.boolean(),
});

export const f1RaceWeekendSchema = z.object({
  id: z.uuid(),
  season: z.number().int(),
  round: z.number().int().min(1),
  name: z.string().min(1),
  circuitKey: z.string().min(1),
  isSprintWeekend: z.boolean(),
  sessions: z.array(f1SessionSchema),
});

export const f1MarketOutcomeSchema = z.object({
  selection: f1SelectionStringSchema,
  decimalOdds: decimalOddsSchema,
});

export const f1MarketSchema = z.object({
  id: f1MarketIdSchema,
  sessionId: z.uuid(),
  kind: f1MarketKindSchema,
  status: z.enum(["OPEN", "CLOSED", "SETTLED", "CANCELLED"]),
  version: z.string().min(1),
  dataAsOf: z.iso.datetime(),
  outcomes: z.array(f1MarketOutcomeSchema),
});

/** Admin publish of a new immutable odds version for one session market. */
export const f1PublishOddsRequestSchema = z.object({
  sessionId: z.uuid(),
  kind: f1MarketKindSchema,
  version: z.string().min(1).max(64),
  dataAsOf: z.iso.datetime(),
  outcomes: z.array(f1MarketOutcomeSchema).min(1),
});

/** Admin result entry (Phase 3 API): one full official classification per version. */
export const f1ClassificationEntrySchema = z.object({
  driverCode: f1DriverCodeSchema,
  position: z.number().int().min(1).nullable(),
  status: f1ClassificationStatusSchema,
  lapsCompleted: z.number().int().min(0),
});

export const f1ResultEntryRequestSchema = z.object({
  sessionId: z.uuid(),
  classification: z.array(f1ClassificationEntrySchema).min(1),
});

export type F1SessionDto = z.infer<typeof f1SessionSchema>;
export type F1RaceWeekendDto = z.infer<typeof f1RaceWeekendSchema>;
export type F1MarketDto = z.infer<typeof f1MarketSchema>;
export type F1PublishOddsRequest = z.infer<typeof f1PublishOddsRequestSchema>;
export type F1ResultEntryRequest = z.infer<typeof f1ResultEntryRequestSchema>;
