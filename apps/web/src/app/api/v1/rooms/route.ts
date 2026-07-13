import { roomHandlers } from "./_lib/routes";
export const runtime = "nodejs";
export const GET = (request: Request) => roomHandlers().list(request);
export const POST = (request: Request) => roomHandlers().create(request);
