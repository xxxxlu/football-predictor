import { NextResponse } from "next/server";
import { resolveSessionUser } from "@/features/billing/guard";
import { getBillingService } from "@/features/billing/runtime";

export async function POST(request: Request) {
  const user = await resolveSessionUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Please sign in to start your free trial" },
      { status: 401 },
    );
  }

  const billing = getBillingService();
  try {
    const subscription = await billing.activateTrial(user.userId);
    return NextResponse.json({
      success: true,
      message: "PULSE PRO 7-day free trial activated successfully",
      subscription,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        error: "TRIAL_ALREADY_CLAIMED",
        message: error instanceof Error ? error.message : "Unable to activate free trial",
      },
      { status: 400 },
    );
  }
}
