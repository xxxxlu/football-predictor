import { NextResponse } from "next/server";
import { resolveSessionUser } from "@/features/billing/guard";
import { getBillingService } from "@/features/billing/runtime";

export async function GET(
  request: Request,
  props: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await props.params;
  const user = await resolveSessionUser(request);

  let isPro = false;
  let trialAvailable = true;

  if (user) {
    const billing = getBillingService();
    const profile = await billing.getProfile(user.userId);
    isPro = profile.isPro;
    trialAvailable = profile.trialAvailable;
  }

  // Pseudo-deterministic data derivation by match ID
  const hash = Math.abs(
    matchId.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0),
  );
  const homeProb = 38 + (hash % 25);
  const drawProb = 20 + ((hash >> 2) % 12);
  const awayProb = Math.max(10, 100 - homeProb - drawProb);
  const xGHome = (1.2 + ((hash % 15) / 10)).toFixed(2);
  const xGAway = (0.8 + (((hash >> 3) % 14) / 10)).toFixed(2);

  const baseInsights = {
    matchId,
    probabilities: { home: homeProb, draw: drawProb, away: awayProb },
    expectedGoals: { home: Number(xGHome), away: Number(xGAway) },
  };

  if (!isPro) {
    return NextResponse.json({
      ...baseInsights,
      isPro: false,
      trialAvailable,
      sharpAction: null,
      lockedReason: "PULSE PRO subscription required to view sharp money flow and VIP indicators",
    });
  }

  // Full unlocked quantitative indicators for VIP subscribers
  return NextResponse.json({
    ...baseInsights,
    isPro: true,
    sharpAction: {
      oddsDefenseShift: -0.18,
      marketConvergence: "离散度显著收窄",
      injuryRiskIndex: {
        level: "中等偏高",
        impactScore: 68,
        affectedPositions: ["主力前锋", "后腰"],
      },
      recommendedValueMarket: "客队 +0.5 让胜",
      confidencePercent: 78,
    },
  });
}
