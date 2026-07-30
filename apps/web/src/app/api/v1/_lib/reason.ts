import { GOVERNANCE_REASON_MAX, GOVERNANCE_REASON_MIN, governanceReasonLength } from "@pulse/domain";
import { z } from "zod";

/**
 * A written justification, bounded the way the database bounds it.
 *
 * `z.string().min(n)` counts UTF-16 units while the `char_length` CHECK counts
 * code points, so a reason of three emoji passed a minimum of five here and then
 * violated the constraint — a 500 where the operator should have seen a 422. Both
 * ends are measured in code points so the two layers agree.
 */
export function governanceReason(min: number = GOVERNANCE_REASON_MIN, max: number = GOVERNANCE_REASON_MAX) {
  return z.string().trim().refine(
    (value) => {
      const length = governanceReasonLength(value);
      return length >= min && length <= max;
    },
    { message: `Give a reason between ${min} and ${max} characters.` },
  );
}
