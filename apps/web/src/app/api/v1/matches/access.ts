import { readSessionToken } from "../auth/_lib/handlers";
import { MatchAccessError, type MatchReadAccess } from "./runtime";

export async function authorizeMatchRead(request: Request, access: MatchReadAccess): Promise<{ userId: string } | Response> {
  const token = readSessionToken(request);
  const account = token ? await access.authenticate(token) : null;
  if (!account) return failure("UNAUTHENTICATED", "Log in to continue.", 401);
  const roomId = new URL(request.url).searchParams.get("roomId")?.trim();
  if (roomId) {
    try { await access.assertRoomMember(roomId, account.id); }
    catch (error) {
      if (error instanceof MatchAccessError) return failure(error.code, "The requested room was not found.", error.status);
      return failure("ROOM_NOT_FOUND", "The requested room was not found.", 404);
    }
  }
  return { userId: account.id };
}

function failure(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store" } });
}
