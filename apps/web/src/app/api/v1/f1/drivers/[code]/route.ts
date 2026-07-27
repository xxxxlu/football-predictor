import { driverSeason } from "@/features/f1/stats";
import { authorizeF1Read, CURRENT_F1_SEASON, f1Failure, f1Json, getF1Repository, refreshF1ReadModel } from "../../_lib/runtime";

export const runtime = "nodejs";

const DRIVER_CODE = /^[A-Z]{3}$/;

export async function GET(request: Request, context: { params: Promise<{ code: string }> }): Promise<Response> {
  const authorization = await authorizeF1Read(request);
  if (authorization instanceof Response) return authorization;
  const { code } = await context.params;
  if (!DRIVER_CODE.test(code)) return f1Failure("DRIVER_NOT_FOUND", "The requested driver was not found.", 404);
  try {
    await refreshF1ReadModel();
    const repository = getF1Repository();
    const drivers = await repository.listDrivers();
    const driver = drivers.find((candidate) => candidate.code === code);
    if (!driver) return f1Failure("DRIVER_NOT_FOUND", "The requested driver was not found.", 404);
    const results = await repository.listConfirmedSessionResults(CURRENT_F1_SEASON);
    const { entries, totals } = driverSeason(code, results);
    const teammate = drivers.find((candidate) => candidate.constructorKey === driver.constructorKey && candidate.code !== code) ?? null;
    return f1Json({
      driver,
      season: CURRENT_F1_SEASON,
      standing: { position: drivers.findIndex((candidate) => candidate.code === code) + 1, of: drivers.length },
      teammate: teammate ? { code: teammate.code, name: teammate.name, seasonPoints: teammate.seasonPoints } : null,
      totals,
      entries,
    });
  } catch {
    return f1Failure("DATA_UNAVAILABLE", "F1 driver data is temporarily unavailable", 503);
  }
}
