export type OddsFormat = "decimal" | "fractional" | "american";

export const ODDS_FORMAT_COOKIE = "pulse_odds_format";
export const SUPPORTED_ODDS_FORMATS: readonly OddsFormat[] = ["decimal", "fractional", "american"];

/**
 * Converts a decimal odds string or number into British fractional odds (e.g. "2.50" -> "3/2", "2.10" -> "11/10").
 */
export function decimalToFractional(decimalOdds: number): string {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return "1/1";
  const profit = decimalOdds - 1;

  // Common fixed sports book fractions table for clean display
  const commonMap: Array<[number, string]> = [
    [0.1, "1/10"], [0.2, "1/5"], [0.25, "1/4"], [0.33, "1/3"], [0.4, "2/5"],
    [0.5, "1/2"], [0.57, "4/7"], [0.6, "3/5"], [0.67, "2/3"], [0.73, "8/11"],
    [0.8, "4/5"], [0.83, "5/6"], [0.91, "10/11"], [1.0, "1/1"], [1.1, "11/10"],
    [1.2, "6/5"], [1.25, "5/4"], [1.38, "11/8"], [1.5, "3/2"], [1.62, "13/8"],
    [1.75, "7/4"], [1.88, "15/8"], [2.0, "2/1"], [2.2, "11/5"], [2.25, "9/4"],
    [2.5, "5/2"], [2.75, "11/4"], [3.0, "3/1"], [3.5, "7/2"], [4.0, "4/1"],
    [4.5, "9/2"], [5.0, "5/1"], [6.0, "6/1"], [7.0, "7/1"], [8.0, "8/1"],
    [9.0, "9/1"], [10.0, "10/1"]
  ];

  for (const [val, str] of commonMap) {
    if (Math.abs(profit - val) < 0.03) return str;
  }

  // Fraction approximation using Farey-like continued fraction algorithm
  const tolerance = 0.01;
  let h1 = 1, h2 = 0, k1 = 0, k2 = 1;
  let b = profit;
  do {
    const a = Math.floor(b);
    let aux = h1;
    h1 = a * h1 + h2;
    h2 = aux;
    aux = k1;
    k1 = a * k1 + k2;
    k2 = aux;
    b = 1 / (b - a);
  } while (Math.abs(profit - h1 / k1) > profit * tolerance && k1 < 100);

  return `${h1}/${k1}`;
}

/**
 * Converts a decimal odds string or number into American / Moneyline odds (e.g. "2.10" -> "+110", "1.50" -> "-200").
 */
export function decimalToAmerican(decimalOdds: number): string {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return "+100";
  if (decimalOdds >= 2.0) {
    const value = Math.round((decimalOdds - 1) * 100);
    return `+${value}`;
  }
  const value = Math.round(100 / (decimalOdds - 1));
  return `-${value}`;
}

/**
 * Formats a raw odds value according to the target format.
 */
export function formatOdds(raw: string | number | undefined | null, format: OddsFormat = "decimal"): string {
  if (raw === undefined || raw === null || raw === "" || raw === "—") return "—";
  const num = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(num)) return String(raw);

  switch (format) {
    case "fractional":
      return decimalToFractional(num);
    case "american":
      return decimalToAmerican(num);
    case "decimal":
    default:
      return num.toFixed(2);
  }
}
