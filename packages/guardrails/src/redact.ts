/**
 * Redaction of a structure by key name, for anything that ships arbitrary
 * metadata to a place a person will read it — an audit trail, a support console,
 * a log line.
 *
 * It redacts on the *key*, never on the value, because the writer is the thing
 * you cannot trust to be careful. A rule keyed on value shape has to guess what a
 * token looks like; a rule keyed on name holds no matter what a future caller
 * decides to stuff into `recoveryCode`.
 *
 * Two matching modes, and the difference is load-bearing:
 *
 *  - `substrings` matches anywhere in the key. Right for secret-ish words, which
 *    compound freely (`apiKey`, `refreshToken`, `passwordHash`).
 *  - `words` matches only a whole underscore-delimited word after the key is
 *    normalised to snake_case. Right for short words that occur *inside* ordinary
 *    ones: `ip` sits in `description` and `recipient`, and redacting an operator's
 *    own written reason is a worse outcome than the leak it was guarding against.
 *
 * Normalising to snake_case first is what makes `reporterIpAddress` and
 * `reporter_ip_address` the same key.
 */

export interface KeyRedactorOptions {
  /** Matched anywhere in the key, case-insensitively. */
  substrings?: readonly string[];
  /** Matched as a whole word of the snake_cased key. */
  words?: readonly string[];
  /** What a redacted value is replaced with. */
  marker?: string;
}

export const DEFAULT_REDACTION_MARKER = "[REDACTED]";

export function createKeyRedactor(options: KeyRedactorOptions): (value: unknown) => unknown {
  const marker = options.marker ?? DEFAULT_REDACTION_MARKER;
  const substrings = options.substrings?.length
    ? new RegExp(`(${options.substrings.map(escape).join("|")})`, "i")
    : null;
  const words = options.words?.length
    ? new RegExp(`(^|_)(${options.words.map(escape).join("|")})(_|$)`)
    : null;

  const isSensitive = (key: string): boolean => {
    if (substrings?.test(key)) return true;
    if (!words) return false;
    return words.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
  };

  const redact = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        output[key] = isSensitive(key) ? marker : redact(entry);
      }
      return output;
    }
    return value;
  };

  return redact;
}

function escape(pattern: string): string {
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
