import { formatEventTitle } from "../matchday/selection-label";

/** View model for the room owner's submission wall — sport-neutral: football
 *  renders "主队 对 客队", F1 renders "分站 · 场次". Only names and the
 *  submitted boolean pass through; the wall never sees selections or stakes. */

export type SubmissionMember = {
  userId: string;
  displayName: string;
  submitted: boolean;
  /** Story 12.6: same-origin media path; null when there is no avatar or the
   *  viewer has blocked this member. Still no selection, stake or odds here. */
  avatarUrl?: string | null;
  avatarVersion?: number | null;
};
export type SubmissionEvent = {
  matchId: string;
  sport?: "FOOTBALL" | "FORMULA_1";
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  status: "OPEN" | "CLOSED" | "FINISHED";
  members: SubmissionMember[];
};

const statusLabels: Record<SubmissionEvent["status"], string> = { OPEN: "可参与", CLOSED: "已封盘", FINISHED: "已结束" };

export function submissionEventTitle(event: Pick<SubmissionEvent, "matchId" | "homeTeam" | "awayTeam">): string {
  return formatEventTitle({ matchId: event.matchId, homeTeam: event.homeTeam, awayTeam: event.awayTeam });
}

export function submissionStatusLabel(status: SubmissionEvent["status"]): string {
  return statusLabels[status];
}

export function submissionSummary(members: readonly SubmissionMember[]): { submitted: number; total: number } {
  return { submitted: members.filter((member) => member.submitted).length, total: members.length };
}
