import { randomUUID } from "node:crypto";
import { createReadyResponse } from "./handler";

export async function GET(request: Request): Promise<Response> {
  const candidate = request.headers.get("x-correlation-id")?.trim();
  const correlationId = candidate && candidate.length <= 128 ? candidate : randomUUID();
  return createReadyResponse(process.env, correlationId);
}
