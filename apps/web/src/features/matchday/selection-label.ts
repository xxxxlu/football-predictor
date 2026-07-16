// Maps a stored prediction selection to its Chinese display label.
// Handles both 1X2 selections (HOME/DRAW/AWAY) and correct-score selections
// ("2-1" listed scores, or "OTHER" for any score outside the listed set).
const ONE_X_TWO_LABELS: Readonly<Record<string, string>> = { HOME: "主胜", DRAW: "平局", AWAY: "客胜" };

export function formatSelectionLabel(selection: string): string {
  if (selection in ONE_X_TWO_LABELS) return ONE_X_TWO_LABELS[selection];
  if (selection === "OTHER") return "其它比分";
  const score = /^(\d{1,2})-(\d{1,2})$/.exec(selection);
  if (score) return `比分 ${score[1]}:${score[2]}`;
  return selection;
}

// Compact label for correct-score option buttons (no "比分" prefix).
export function scoreChipLabel(selection: string): string {
  if (selection === "OTHER") return "其它比分";
  const score = /^(\d{1,2})-(\d{1,2})$/.exec(selection);
  return score ? `${score[1]}:${score[2]}` : selection;
}
