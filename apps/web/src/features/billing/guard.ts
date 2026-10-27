import { NextResponse } from "next/server";
import { readSessionToken } from "@/app/api/v1/auth/_lib/session-token";
import { getIdentityService } from "@/app/api/v1/auth/_lib/runtime";
import { getBillingService } from "./runtime";

export async function resolveSessionUser(request: Request): Promise<{ userId: string } | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  const identity = getIdentityService();
  try {
    const account = await identity.authenticate(token);
    if (!account) return null;
    return { userId: account.id };
  } catch {
    return null;
  }
}


export async function requireProUser(request: Request): Promise<
  { userId: string } | NextResponse
> {
  const user = await resolveSessionUser(request);
  if (!user) {
    return NextResponse.json(
      { error: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 },
    );
  }

  const billing = getBillingService();
  const profile = await billing.getProfile(user.userId);
  if (!profile.isPro) {
    return NextResponse.json(
      {
        error: "PRO_SUBSCRIPTION_REQUIRED",
        message: "This feature requires an active PULSE PRO membership",
        trialAvailable: profile.trialAvailable,
      },
      { status: 403 },
    );
  }

  return { userId: user.userId };
}
