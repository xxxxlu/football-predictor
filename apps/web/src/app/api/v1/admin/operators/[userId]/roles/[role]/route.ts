import { getIdentityService } from "../../../../../auth/_lib/runtime";
import { createOperatorRoleHandlers } from "../../../handlers";

export const runtime = "nodejs";

type Context = { params: Promise<{ userId: string; role: string }> };

export const PUT = async (request: Request, context: Context) => {
  const { userId, role } = await context.params;
  return createOperatorRoleHandlers(getIdentityService()).grant(request, userId, role);
};

export const DELETE = async (request: Request, context: Context) => {
  const { userId, role } = await context.params;
  return createOperatorRoleHandlers(getIdentityService()).revoke(request, userId, role);
};
