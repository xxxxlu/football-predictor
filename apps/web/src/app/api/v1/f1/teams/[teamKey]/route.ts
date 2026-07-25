import { teamSeason } from "@/features/f1/stats";
import { authorizeF1Read, CURRENT_F1_SEASON, f1Failure, f1Json, getF1Repository } from "../../_lib/runtime";

export const runtime = "nodejs";

const TEAM_KEY = /^[a-z][a-z0-9-]{1,40}$/;

export async function GET(request: Request, context: { params: Promise<{ teamKey: string }> }): Promise<Response> {
  const authorization = await authorizeF1Read(request);
  if (authorization instanceof Response) return authorization;
  const { teamKey } = await context.params;
  if (!TEAM_KEY.test(teamKey)) return f1Failure("TEAM_NOT_FOUND", "The requested team was not found.", 404);
  try {
    const repository = getF1Repository();
    const drivers = await repository.listDrivers();
    const teamDrivers = drivers.filter((candidate) => candidate.constructorKey === teamKey);
    if (!teamDrivers.length) return f1Failure("TEAM_NOT_FOUND", "The requested team was not found.", 404);
    const results = await repository.listConfirmedSessionResults(CURRENT_F1_SEASON);
    const { rounds, totals } = teamSeason(teamDrivers.map((driver) => driver.code), results);
    const pointsByTeam = new Map<string, number>();
    for (const driver of drivers) {
      pointsByTeam.set(driver.constructorKey, (pointsByTeam.get(driver.constructorKey) ?? 0) + driver.seasonPoints);
    }
    const teamStandings = [...pointsByTeam.entries()].sort((a, b) => b[1] - a[1]);
    return f1Json({
      team: {
        key: teamKey,
        name: teamDrivers[0]?.constructorName ?? teamKey,
        color: teamDrivers[0]?.color ?? "#5f635e",
        seasonPoints: pointsByTeam.get(teamKey) ?? 0,
      },
      season: CURRENT_F1_SEASON,
      standing: { position: teamStandings.findIndex(([key]) => key === teamKey) + 1, of: teamStandings.length },
      drivers: teamDrivers.sort((a, b) => b.seasonPoints - a.seasonPoints),
      totals,
      rounds,
    });
  } catch {
    return f1Failure("DATA_UNAVAILABLE", "F1 team data is temporarily unavailable", 503);
  }
}
