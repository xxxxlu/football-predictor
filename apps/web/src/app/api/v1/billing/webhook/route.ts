import { NextResponse } from "next/server";
import { getBillingService } from "@/features/billing/runtime";

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature") || "";

  const billing = getBillingService();
  try {
    const result = await billing.handleWebhook(payload, signature);
    return NextResponse.json({ received: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "WEBHOOK_VERIFICATION_FAILED", message: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 400 },
    );
  }
}
