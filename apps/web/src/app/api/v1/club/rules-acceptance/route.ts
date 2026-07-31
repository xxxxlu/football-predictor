import { lobbyHandlers } from "../../_lib/lobby-runtime";
export const runtime = "nodejs";
export const GET = (request: Request) => lobbyHandlers().rulesGet(request);
export const POST = (request: Request) => lobbyHandlers().rulesAccept(request);
