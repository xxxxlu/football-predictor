import { NextResponse } from "next/server";
import { resolveSessionUser } from "@/features/billing/guard";
import { getBillingService } from "@/features/billing/runtime";

export async function POST(request: Request) {
  const user = await resolveSessionUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Please sign in to subscribe" },
      { status: 401 },
    );
  }

  let body: { planTier?: "PRO_MONTHLY" | "PRO_ANNUAL" } = {};
  try {
    body = await request.json();
  } catch {
    // defaults to PRO_MONTHLY
  }

  const planTier = body.planTier === "PRO_ANNUAL" ? "PRO_ANNUAL" : "PRO_MONTHLY";
  const origin = request.headers.get("origin") || "http://localhost:3000";

  const billing = getBillingService();
  try {
    const session = await billing.createCheckout(user.userId, planTier, origin);
    return NextResponse.json(session);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "CHECKOUT_FAILED", message: error instanceof Error ? error.message : "Failed to create checkout session" },
      { status: 500 },
    );
  }
}
