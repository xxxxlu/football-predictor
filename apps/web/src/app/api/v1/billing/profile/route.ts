import { NextResponse } from "next/server";
import { resolveSessionUser } from "@/features/billing/guard";
import { getBillingService } from "@/features/billing/runtime";

export async function GET(request: Request) {
  const user = await resolveSessionUser(request);
  if (!user) {
    return NextResponse.json({
      isPro: false,
      trialAvailable: true,
      daysRemaining: 0,
      subscription: null,
    });
  }

  const billing = getBillingService();
  const profile = await billing.getProfile(user.userId);
  return NextResponse.json(profile);
}
