import { roomHandlers } from "../_lib/routes";

export const runtime = "nodejs";
export const GET = (request: Request) => roomHandlers().listPublic(request);
