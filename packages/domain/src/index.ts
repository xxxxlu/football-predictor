/** domain package boundary. Business modules are added by their owning stories. */
export const packageName = "@football-predictor/domain" as const;
export * from "./identity/service.js";
export * from "./rooms/service.js";
export * from "./predictions/ticket-submission.js";
export * from "./settlement/settlement.js";
export * from "./competition/index.js";
export * from "./supplier-budget/index.js";
