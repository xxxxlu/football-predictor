/**
 * Daily sports challenge (Story 12.2, FR86).
 *
 * The question bank is a versioned domain constant table (the f1/season-2026
 * precedent): content ships with the build, never as migration seeds. Selection
 * is deterministic per product day, scoring happens server-side only, and the
 * public projection type structurally lacks the correct answer — there is no
 * field to blank out, so no code path can leak it (AC2).
 *
 * XP is an integer engagement counter, never a point balance: nothing here may
 * reference or influence prediction points, odds, settlement or leaderboards
 * (AC4, FR59, PRD L204).
 */

import { previousProductDay, productDayNumber } from "./product-day.js";

export const CHALLENGE_BANK_VERSION = 1;
export const XP_RULES_VERSION = 1;

export const XP_PER_CORRECT_ANSWER = 10;
export const XP_STREAK_BONUS_CAP = 7;

export interface LocalizedText {
  zh: string;
  en: string;
}

export const CHALLENGE_OPTION_KEYS = ["A", "B", "C", "D"] as const;
export type ChallengeOptionKey = (typeof CHALLENGE_OPTION_KEYS)[number];

export interface ChallengeOption {
  key: ChallengeOptionKey;
  text: LocalizedText;
}

export interface ChallengeQuestion {
  key: string;
  prompt: LocalizedText;
  options: readonly ChallengeOption[];
  correctOption: ChallengeOptionKey;
}

/** What clients may see before scoring: structurally no `correctOption`. */
export interface PublicChallengeQuestion {
  key: string;
  prompt: LocalizedText;
  options: readonly ChallengeOption[];
}

const q = (
  key: string,
  zh: string,
  en: string,
  options: [string, string][],
  correct: ChallengeOptionKey,
): ChallengeQuestion => ({
  key,
  prompt: { zh, en },
  options: options.map(([optionZh, optionEn], index) => ({
    key: CHALLENGE_OPTION_KEYS[index] as ChallengeOptionKey,
    text: { zh: optionZh, en: optionEn },
  })),
  correctOption: correct,
});

/**
 * First-release bank: 30 timeless rules/history questions (football + F1).
 * Content red line (FR87 sibling rule): no fixtures, no odds, no betting hints.
 * PM sign-off tracked in the story's pending-decisions list.
 */
export const CHALLENGE_BANK: readonly ChallengeQuestion[] = [
  q("fb-regulation-minutes", "一场标准足球比赛的常规时间是多少分钟？", "How many minutes does regulation time last in a standard football match?", [["80 分钟", "80 minutes"], ["90 分钟", "90 minutes"], ["100 分钟", "100 minutes"], ["120 分钟", "120 minutes"]], "B"),
  q("fb-world-cup-cycle", "国际足联世界杯每隔几年举办一次？", "How often is the FIFA World Cup held?", [["每 2 年", "Every 2 years"], ["每 3 年", "Every 3 years"], ["每 4 年", "Every 4 years"], ["每 5 年", "Every 5 years"]], "C"),
  q("fb-players-on-pitch", "足球比赛中每队同时在场上的球员是多少人？", "How many players does each football team field at the same time?", [["9 人", "9"], ["10 人", "10"], ["11 人", "11"], ["12 人", "12"]], "C"),
  q("fb-penalty-distance", "点球点距离球门线大约多远？", "Roughly how far is the penalty spot from the goal line?", [["9 米", "9 metres"], ["11 米", "11 metres"], ["13 米", "13 metres"], ["16 米", "16 metres"]], "B"),
  q("fb-red-card", "球员被出示红牌后会怎样？", "What happens when a player is shown a red card?", [["警告一次", "They receive a warning"], ["罚下且不得被替换", "They are sent off and cannot be replaced"], ["罚下但可换人补位", "They are sent off but can be substituted"], ["暂离场 10 分钟", "They sit out for 10 minutes"]], "B"),
  q("fb-offside-reference", "判定越位时，进攻球员的位置通常与哪名对方球员比较？", "In an offside call, the attacker's position is usually compared against which opponent?", [["门将", "The goalkeeper"], ["最后一名防守球员", "The last defender"], ["倒数第二名防守球员", "The second-to-last defender"], ["队长", "The captain"]], "C"),
  q("fb-world-cup-titles", "哪个国家赢得的男足世界杯冠军最多？", "Which country has won the most men's World Cup titles?", [["德国", "Germany"], ["意大利", "Italy"], ["阿根廷", "Argentina"], ["巴西", "Brazil"]], "D"),
  q("fb-hat-trick", "「帽子戏法」指一名球员在一场比赛中进几个球？", "A hat-trick means how many goals by one player in a single match?", [["2 球", "2 goals"], ["3 球", "3 goals"], ["4 球", "4 goals"], ["5 球", "5 goals"]], "B"),
  q("fb-epl-rounds", "英超一个赛季每支球队要踢多少轮联赛？", "How many league rounds does each Premier League team play in a season?", [["34 轮", "34"], ["36 轮", "36"], ["38 轮", "38"], ["42 轮", "42"]], "C"),
  q("fb-bundesliga-teams", "德甲联赛由多少支球队组成？", "How many teams make up the Bundesliga?", [["16 支", "16"], ["18 支", "18"], ["20 支", "20"], ["22 支", "22"]], "B"),
  q("fb-ucl-old-name", "欧冠改制前的赛事名称是什么？", "What was the UEFA Champions League called before its rebrand?", [["欧洲联盟杯", "UEFA Cup"], ["欧洲优胜者杯", "Cup Winners' Cup"], ["欧洲冠军杯", "European Cup"], ["欧洲超级杯", "UEFA Super Cup"]], "C"),
  q("fb-keeper-hands", "门将可以在哪个区域内用手触球？", "Where may a goalkeeper handle the ball?", [["整个半场", "Anywhere in their half"], ["本方禁区内", "Inside their own penalty area"], ["本方小禁区内", "Inside their own six-yard box"], ["任何位置", "Anywhere on the pitch"]], "B"),
  q("fb-kickoff-spot", "足球比赛的开球在哪里进行？", "Where does a football match kick off?", [["中圈", "The centre circle"], ["禁区弧顶", "The edge of the box"], ["角旗区", "The corner arc"], ["任意位置", "Anywhere"]], "A"),
  q("fb-var-meaning", "VAR 的完整含义是什么？", "What does VAR stand for?", [["虚拟辅助回放", "Virtual Assisted Replay"], ["视频助理裁判", "Video Assistant Referee"], ["可变角度回放", "Variable Angle Replay"], ["视频仲裁规则", "Video Arbitration Rule"]], "B"),
  q("fb-indirect-fk", "间接任意球直接射入对方球门，进球有效吗？", "If an indirect free kick goes straight into the opponents' goal, does it count?", [["有效", "Yes, it counts"], ["无效，判门球", "No, a goal kick is given"], ["重踢", "The kick is retaken"], ["点球", "A penalty is given"]], "B"),
  q("fb-corner-spot", "角球从哪里开出？", "Where is a corner kick taken from?", [["球门线中点", "The middle of the goal line"], ["角旗区", "The corner arc"], ["边线任意点", "Anywhere on the touchline"], ["禁区线上", "On the edge of the box"]], "B"),
  q("fb-minimum-players", "一支球队场上至少要有几名球员，比赛才能继续？", "What is the minimum number of players a team needs on the pitch for play to continue?", [["5 人", "5"], ["6 人", "6"], ["7 人", "7"], ["8 人", "8"]], "C"),
  q("fb-throw-in", "界外球应该怎么掷？", "How must a throw-in be taken?", [["单手从头顶掷出", "One-handed over the head"], ["双手从头后经头顶掷出", "Two-handed from behind and over the head"], ["双手从胸前推出", "Two-handed from the chest"], ["任意方式", "Any way you like"]], "B"),
  q("fb-olympic-age", "奥运会男足对球员年龄的基本要求是什么？", "What is the basic age rule for men's Olympic football?", [["无限制", "No limit"], ["23 岁以下＋3 名超龄", "Under-23 plus 3 overage players"], ["21 岁以下", "Under-21 only"], ["全部超龄", "Overage players only"]], "B"),
  q("fb-golden-boot", "世界杯「金靴奖」颁给什么表现的球员？", "The World Cup Golden Boot is awarded for what?", [["最佳门将", "Best goalkeeper"], ["最佳新人", "Best young player"], ["进球最多", "Most goals scored"], ["助攻最多", "Most assists"]], "C"),
  q("f1-race-win-points", "F1 正赛冠军可以获得多少个积分？", "How many points does an F1 race winner score?", [["18 分", "18"], ["20 分", "20"], ["25 分", "25"], ["30 分", "30"]], "C"),
  q("f1-teams-2026", "2026 赛季 F1 共有多少支车队？", "How many constructors race in the 2026 F1 season?", [["10 支", "10"], ["11 支", "11"], ["12 支", "12"], ["13 支", "13"]], "B"),
  q("f1-qualifying-decides", "F1 排位赛的成绩决定什么？", "What does F1 qualifying determine?", [["积分排名", "Championship order"], ["正赛发车顺位", "The race starting grid"], ["进站顺序", "Pit stop order"], ["车队预算", "Team budgets"]], "B"),
  q("f1-pole-position", "「杆位」指的是什么？", "What is pole position?", [["排位赛第一", "First place in qualifying"], ["正赛第一", "Winning the race"], ["最快圈速", "The fastest lap"], ["年度冠军", "The championship title"]], "A"),
  q("f1-dry-compounds", "干地正赛中，规则要求每位车手至少使用几种轮胎配方？", "In a dry race, how many different tyre compounds must each driver use?", [["1 种", "1"], ["2 种", "2"], ["3 种", "3"], ["没有要求", "No requirement"]], "B"),
  q("f1-red-flag", "F1 比赛中红旗代表什么？", "What does a red flag mean in F1?", [["最后一圈", "Final lap"], ["比赛中断", "The session is stopped"], ["进站开放", "Pit lane open"], ["超车禁令", "No overtaking"]], "B"),
  q("f1-blue-flag", "蓝旗要求被套圈的车手做什么？", "What does a blue flag ask a lapped driver to do?", [["立即进站", "Pit immediately"], ["让快车通过", "Let the faster car through"], ["减速至限速", "Slow to the speed limit"], ["退出比赛", "Retire from the race"]], "B"),
  q("f1-most-titles", "F1 历史上世界冠军头衔并列最多的两位车手是谁？", "Which two drivers share the record for most F1 world titles?", [["塞纳与普罗斯特", "Senna and Prost"], ["舒马赫与汉密尔顿", "Schumacher and Hamilton"], ["维特尔与阿隆索", "Vettel and Alonso"], ["劳达与斯图尔特", "Lauda and Stewart"]], "B"),
  q("f1-monaco-track", "摩纳哥大奖赛在什么类型的赛道上举行？", "What kind of circuit hosts the Monaco Grand Prix?", [["永久赛道", "A permanent circuit"], ["街道赛道", "A street circuit"], ["椭圆赛道", "An oval"], ["越野赛道", "An off-road course"]], "B"),
  q("f1-podium-places", "F1 分站赛登上领奖台的是完赛前几名？", "Which finishing positions stand on an F1 podium?", [["前 2 名", "Top 2"], ["前 3 名", "Top 3"], ["前 5 名", "Top 5"], ["前 10 名", "Top 10"]], "B"),
];

/** Deterministic daily rotation: same product day, same question, everywhere. */
export function questionForProductDay(day: string): ChallengeQuestion {
  const index = ((productDayNumber(day) % CHALLENGE_BANK.length) + CHALLENGE_BANK.length) % CHALLENGE_BANK.length;
  return CHALLENGE_BANK[index] as ChallengeQuestion;
}

export function questionByKey(key: string): ChallengeQuestion | null {
  return CHALLENGE_BANK.find((question) => question.key === key) ?? null;
}

/** Strips the answer at the type level — the return shape cannot carry it. */
export function toPublicQuestion(question: ChallengeQuestion): PublicChallengeQuestion {
  return { key: question.key, prompt: question.prompt, options: question.options };
}

export function isCorrectAnswer(question: ChallengeQuestion, answer: ChallengeOptionKey): boolean {
  return question.correctOption === answer;
}

/**
 * Streak semantics: consecutive product days with a CORRECT answer. A wrong
 * answer resets to zero; skipping a day breaks the chain even if yesterday
 * was right (隔产品日断连).
 */
export function nextStreak(input: {
  lastAnsweredDay: string | null;
  currentStreak: number;
  day: string;
  correct: boolean;
}): number {
  if (!input.correct) return 0;
  return input.lastAnsweredDay === previousProductDay(input.day) ? input.currentStreak + 1 : 1;
}

/** XP for one attempt: 10 for a correct answer plus a capped streak bonus. */
export function xpForAnswer(correct: boolean, streakAfter: number): number {
  return correct ? XP_PER_CORRECT_ANSWER + Math.min(streakAfter, XP_STREAK_BONUS_CAP) : 0;
}
