/**
 * 积分数字的统一呈现（品牌方案 §7.3 数字设计）。
 *
 * 服务端一律返回定点小数字符串（`"10000.00"`、`"0.00"`），直接打到界面上会让
 * 排行榜整列读成 `0.00 | 10000.00 | 0.00`——三个恒定的 `.00` 在 tabular-nums
 * 下占满宽度却不携带任何信息，同时四位数以上没有千分位，`10000` 和 `100000`
 * 只能靠数字符数分辨。
 *
 * 规则：
 * - 千分位始终分组；
 * - 整数值去掉尾随的 `.00`；
 * - 真实小数保留两位（`grossReturnPoints = stake × odds` 会算出 336.33 这种值，
 *   不能一刀切抹掉小数）。
 *
 * 代价是同一列里 `10,000` 与 `336.33` 不再严格按小数点对齐；但小数在这些列里
 * 是少数派，为它们把整列钉死成 `.00` 换来的对齐并不划算。
 */

const GROUPING = new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const GROUPING_2DP = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 数值本身；解析失败（空串、`null`、非数字）返回 `null`，由调用方决定占位符。 */
function toNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/** 积分/投入/返还等无符号数值。`fallback` 用于数据缺失，默认破折号。 */
export function formatPoints(value: string | number | null | undefined, fallback = "—") {
  const number = toNumber(value);
  if (number === null) return fallback;
  return Number.isInteger(number) ? GROUPING.format(number) : GROUPING_2DP.format(number);
}

/** 变化值：§7.3 要求带正负号，不只依赖颜色。零值不加号。 */
export function formatPointsDelta(value: string | number | null | undefined, fallback = "—") {
  const number = toNumber(value);
  if (number === null) return fallback;
  return `${number > 0 ? "+" : ""}${formatPoints(number)}`;
}

/** 倍率（赔率）：始终两位小数，1.5 和 1.50 在同一列里必须等宽。 */
export function formatOdds(value: string | number | null | undefined, fallback = "—") {
  const number = toNumber(value);
  if (number === null) return fallback;
  return number.toFixed(2);
}
