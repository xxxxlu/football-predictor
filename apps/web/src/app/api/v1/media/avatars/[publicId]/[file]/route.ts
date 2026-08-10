import { avatarHandlers } from "../../../../_lib/avatar-runtime";
export const runtime = "nodejs";
export const GET = async (request: Request, context: { params: Promise<{ publicId: string; file: string }> }) => {
  const { publicId, file } = await context.params;
  return avatarHandlers().media(request, publicId, file);
};
