import { avatarHandlers } from "../../_lib/avatar-runtime";
export const runtime = "nodejs";
export const POST = (request: Request) => avatarHandlers().upload(request);
export const DELETE = (request: Request) => avatarHandlers().remove(request);
