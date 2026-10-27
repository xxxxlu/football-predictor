import { NextResponse } from "next/server";
import { resolveSessionUser } from "@/features/billing/guard";
import { getBillingService } from "@/features/billing/runtime";
import { z } from "zod";

const subscribeSchema = z.object({
  planTier: z.enum(["PRO_MONTHLY", "PRO_ANNUAL"]),
});

export async function POST(request: Request) {
  const user = await resolveSessionUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "请先登录以开通 PULSE PRO 会员" },
      { status: 401 },
    );
  }

  try {
    const json = await request.json().catch(() => ({}));
    const parsed = subscribeSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "INVALID_PLAN", message: "无效的订阅计划" },
        { status: 400 },
      );
    }

    const billing = getBillingService();
    const subscription = await billing.subscribeWithPoints(user.userId, parsed.data.planTier);
    const profile = await billing.getProfile(user.userId);

    return NextResponse.json({
      success: true,
      message: "PULSE PRO 会员已成功使用积分开通",
      subscription,
      daysRemaining: profile.daysRemaining,
      availablePoints: profile.availablePoints,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "";
    const isPoints = msg.includes("INSUFFICIENT_POINTS");
    return NextResponse.json(
      {
        error: isPoints ? "INSUFFICIENT_POINTS" : "SUBSCRIPTION_FAILED",
        message: msg || "使用积分开通失败，请检查账户积分",
      },
      { status: 400 },
    );
  }
}
