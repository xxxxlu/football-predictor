import { NextResponse } from "next/server";
import { resolveSessionUser } from "@/features/billing/guard";
import { getBillingService } from "@/features/billing/runtime";
import { getPaymentGateway } from "@/features/billing/gateway";

export async function POST(request: Request) {
  const user = await resolveSessionUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 },
    );
  }

  const origin = request.headers.get("origin") || "http://localhost:3000";
  const billing = getBillingService();
  const profile = await billing.getProfile(user.userId);

  const customerId = profile.subscription?.providerCustomerId || `cus_mock_${user.userId}`;
  const gateway = getPaymentGateway();
  const portalUrl = await gateway.createCustomerPortalSession(customerId, origin);

  return NextResponse.json({ portalUrl });
}
