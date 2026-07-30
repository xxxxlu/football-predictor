import { getIdentityService } from "../../auth/_lib/runtime";
import { createGovernanceNoticeHandlers } from "./handlers";
import { governanceInbox } from "./runtime";

/** Member-facing half of the governance surface: an account's own notices. */
export function governanceNoticeHandlers() {
  return createGovernanceNoticeHandlers(getIdentityService(), governanceInbox());
}
