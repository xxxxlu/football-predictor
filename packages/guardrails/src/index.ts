/**
 * Dependency-free primitives for things that are easy to get subtly wrong, pulled
 * out of a production app where each one was written to fix a real failure.
 *
 * Nothing here knows about this product. Each module carries the reasoning that
 * produced it, because in every case the naive version looks correct.
 */
export { DecimalError, isPositiveDecimal, multiplyByDecimal } from "./decimal.js";
export { isSameOrigin, type SameOriginOptions } from "./same-origin.js";
export { createKeyRedactor, DEFAULT_REDACTION_MARKER, type KeyRedactorOptions } from "./redact.js";
export { createCapabilityModel, type CapabilityModel } from "./capabilities.js";
