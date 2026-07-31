/**
 * Daily fortune card (Story 12.2, FR87).
 *
 * Pure deterministic generation: sha256(deck version + userId + productDay)
 * picks a card, so the same user sees the same card all day on every device
 * with zero storage and zero cleanup. Sharing = copying the card text; no new
 * delivery channel.
 *
 * CONTENT RED LINE (FR87, enforced at review): card copy expresses playful
 * sports personas and matchday atmosphere ONLY. It must never name a fixture,
 * suggest a bet, hint at odds or outcomes, or imply "today is a good day to
 * stake" — the card changes nothing about odds, eligibility, settlement or
 * rankings.
 */

import { createHash } from "node:crypto";

import type { LocalizedText } from "./challenge.js";

export const FORTUNE_DECK_VERSION = 1;

export interface FortuneCard {
  key: string;
  title: LocalizedText;
  text: LocalizedText;
}

const card = (key: string, titleZh: string, titleEn: string, textZh: string, textEn: string): FortuneCard => ({
  key,
  title: { zh: titleZh, en: titleEn },
  text: { zh: textZh, en: textEn },
});

/** First-release deck: 12 personas. PM sign-off tracked in the story. */
export const FORTUNE_DECK: readonly FortuneCard[] = [
  card("iron-midfielder", "铁血中场", "Iron Midfielder", "今天的你像一名不知疲倦的中场，哪里需要就出现在哪里。适合把搁置的小事一口气清完。", "You are the box-to-box engine today, showing up wherever you're needed. A good day to clear the small tasks you've been putting off."),
  card("stand-singer", "看台歌者", "Voice of the Stands", "你今天自带主场氛围，随口一句话都能带动周围的节奏。别忘了给身边的人递一句鼓励。", "You carry the home-crowd energy today; even a casual word lifts the room. Pass someone an encouraging line."),
  card("calm-keeper", "冷静门神", "Calm Keeper", "扑出意外的能力今天满格。遇到突发状况先站稳位置，再伸手，稳住就是胜利。", "Your shot-stopping instincts are maxed out. When surprises come, hold your ground first, then reach — staying steady is the win."),
  card("tactics-professor", "战术教授", "Tactics Professor", "今天适合安静复盘：翻出一场经典比赛，看看当年没看懂的那次换人。", "A day for quiet analysis: revisit a classic match and study the substitution you never understood the first time."),
  card("super-sub", "超级替补", "Super Sub", "你是今天的奇兵——后半程发力比抢跑更适合你。留点体力给傍晚。", "You're today's impact player — finishing strong suits you better than sprinting early. Save some legs for the evening."),
  card("pit-wall-strategist", "P 房军师", "Pit Wall Strategist", "你今天脑子里全是时机感：什么时候进、什么时候停，直觉都在线。把日程排顺，一气呵成。", "Your sense of timing is razor-sharp today — when to push, when to box. Line up your schedule and run it in one clean stint."),
  card("late-braker", "晚刹车艺术家", "Late Braker", "别人早早收油，你还敢再等一拍。今天适合把犹豫很久的那件小事定下来。", "Where others lift early, you dare to wait a beat longer. A good day to finally commit to that small decision you've been circling."),
  card("radio-silence", "无线电静默", "Radio Silence", "今天的你适合专注模式：少看消息，多看路。一段不被打扰的时间比什么都珍贵。", "Focus mode suits you today: fewer messages, more track ahead. One uninterrupted stretch is worth everything."),
  card("weather-reader", "读天气的人", "Weather Reader", "你比别人早半拍察觉风向变化。今天多听一句、多看一眼，会省下不少弯路。", "You sense the wind change half a beat before everyone else. Listen a little longer today and you'll skip a few detours."),
  card("corner-specialist", "角球专家", "Corner Specialist", "机会今天藏在边角处。留意那些不起眼的细节，好球往往从死球开始。", "Today's chances hide in the corners. Watch the small details — great plays often start from a dead ball."),
  card("marathon-fan", "全勤观众", "Ever-Present Fan", "你的热情是长跑型的。今天适合给喜欢的事投一点点时间，细水长流最动人。", "Your enthusiasm runs marathons. Give a little time to what you love today — steady devotion is the best kind."),
  card("celebration-choreographer", "庆祝动作设计师", "Celebration Choreographer", "今天值得给自己一个小小的庆祝动作。完成一件事，就认真高兴一次。", "You deserve a signature celebration today. Finish one thing, then properly enjoy it."),
];

/**
 * Deterministic draw: identical inputs yield the identical card, different
 * users get independent draws. No storage involved (AC3).
 */
export function fortuneFor(userId: string, day: string): FortuneCard {
  const digest = createHash("sha256").update(`${FORTUNE_DECK_VERSION}:${userId}:${day}`).digest();
  const index = digest.readUInt32BE(0) % FORTUNE_DECK.length;
  return FORTUNE_DECK[index] as FortuneCard;
}

/** The share payload is plain text of the card itself — nothing else rides along. */
export function fortuneShareText(cardToShare: FortuneCard, locale: "zh" | "en"): string {
  return locale === "zh"
    ? `我今天的 PULSE 运势：「${cardToShare.title.zh}」——${cardToShare.text.zh}`
    : `My PULSE fortune today: "${cardToShare.title.en}" — ${cardToShare.text.en}`;
}
