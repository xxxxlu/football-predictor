import { NextResponse } from "next/server";
import { AuthError } from "@pulse/domain";
import { readSessionToken } from "../../../auth/_lib/handlers";
import { requireAnyCapability } from "../../../_lib/operator-gate";
import { getIdentityService } from "../../../auth/_lib/runtime";
import { getSettlementAuditRepository } from "./runtime";

export const runtime = "nodejs";

const AUDIT_CAPABILITIES = [
  "AUDIT_READ",
  "OPERATIONS_HEALTH_READ",
  "OPERATIONS_TASK_RETRY",
] as const;

export async function GET(request: Request) {
  try {
    const token = readSessionToken(request);
    if (!token) {
      return NextResponse.json(
        { error: { code: "UNAUTHENTICATED", message: "Log in to continue." } },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
    }

    const identity = getIdentityService();
    await requireAnyCapability(identity, token, AUDIT_CAPABILITIES);

    const repository = getSettlementAuditRepository();
    const report = await repository.runAudit();

    return NextResponse.json(
      { data: report },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error: unknown) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.action ?? error.message } },
        { status: error.status, headers: { "cache-control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "Failed to run settlement audit" } },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
