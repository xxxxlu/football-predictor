// Maps a stored prediction selection to its Chinese display label.
// Handles both 1X2 selections (HOME/DRAW/AWAY) and correct-score selections
// ("2-1" listed scores, or "OTHER" for any score outside the listed set).
const ONE_X_TWO_LABELS: Readonly<Record<string, string>> = { HOME: "主胜", DRAW: "平局", AWAY: "客胜" };

export function formatSelectionLabel(selection: string): string {
  if (selection in ONE_X_TWO_LABELS) return ONE_X_TWO_LABELS[selection];
  if (selection === "OTHER") return "其它比分";
  const score = /^(\d{1,2})-(\d{1,2})$/.exec(selection);
  if (score) return `比分 ${score[1]}:${score[2]}`;
  return formatF1SelectionLabel(selection) ?? selection;
}

// F1 selection encodings frozen on legs (domain/f1/selections.ts grammar).
// "头名" covers both POLE (qualifying) and WINNER (race) DRV: selections.
function formatF1SelectionLabel(selection: string): string | null {
  const driver = /^DRV:([A-Z][A-Z0-9]{1,3})$/.exec(selection);
  if (driver) return `头名 ${driver[1]}`;
  const podium = /^PODIUM:([A-Z][A-Z0-9]{1,3}):(YES|NO)$/.exec(selection);
  if (podium) return podium[2] === "YES" ? `${podium[1]} 登领奖台` : `${podium[1]} 无缘领奖台`;
  const exact = /^POD3:([A-Z][A-Z0-9]{1,3})-([A-Z][A-Z0-9]{1,3})-([A-Z][A-Z0-9]{1,3})$/.exec(selection);
  if (exact) return `前三顺序 ${exact[1]}·${exact[2]}·${exact[3]}`;
  const duel = /^H2H:([A-Z][A-Z0-9]{1,3})>([A-Z][A-Z0-9]{1,3})$/.exec(selection);
  if (duel) return `${duel[1]} 先于 ${duel[2]}`;
  return null;
}

const F1_SESSION_TITLE_LABELS: Readonly<Record<string, string>> = {
  QUALIFYING: "排位赛", SPRINT_QUALIFYING: "冲刺排位", SPRINT: "冲刺赛", GRAND_PRIX: "正赛",
};

/** Ticket rows carry football teams or, for F1, the weekend name + session kind.
 *  Renders "主队 对 客队" for football and "大奖赛 · 场次" for F1. */
export function formatEventTitle(input: { matchId?: string; homeTeam: string; awayTeam: string }): string {
  if (input.matchId?.startsWith("f1:")) {
    return `${input.homeTeam} · ${F1_SESSION_TITLE_LABELS[input.awayTeam] ?? input.awayTeam}`;
  }
  return `${input.homeTeam} 对 ${input.awayTeam}`;
}

// Compact label for correct-score option buttons (no "比分" prefix).
export function scoreChipLabel(selection: string): string {
  if (selection === "OTHER") return "其它比分";
  const score = /^(\d{1,2})-(\d{1,2})$/.exec(selection);
  return score ? `${score[1]}:${score[2]}` : selection;
}
