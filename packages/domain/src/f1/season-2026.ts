import type { F1Constructor, F1Driver } from "./types.js";

/** 2026 entry list — 11 constructors, 22 drivers (§12.5; source: FIA 2026 media guide,
 *  mirrored by apps/web/public/design-system/f1/assets-manifest.json). Team colors are
 *  identity strips only, not official brand assets. */

export const F1_SEASON_2026 = 2026;

export const F1_CONSTRUCTORS_2026: readonly F1Constructor[] = [
  { key: "mclaren", name: "McLaren", color: "#FF8000" },
  { key: "mercedes", name: "Mercedes", color: "#27F4D2" },
  { key: "red-bull-racing", name: "Red Bull Racing", color: "#3671C6" },
  { key: "ferrari", name: "Ferrari", color: "#E8002D" },
  { key: "williams", name: "Williams", color: "#64C4FF" },
  { key: "racing-bulls", name: "Racing Bulls", color: "#6692FF" },
  { key: "aston-martin", name: "Aston Martin", color: "#229971" },
  { key: "haas", name: "Haas", color: "#B6BABD" },
  { key: "audi", name: "Audi", color: "#00E701" },
  { key: "alpine", name: "Alpine", color: "#FF87BC" },
  { key: "cadillac", name: "Cadillac", color: "#C8B06C" },
];

export const F1_DRIVERS_2026: readonly F1Driver[] = [
  { code: "NOR", number: 1, name: "Lando Norris", constructorKey: "mclaren", active: true },
  { code: "PIA", number: 81, name: "Oscar Piastri", constructorKey: "mclaren", active: true },
  { code: "RUS", number: 63, name: "George Russell", constructorKey: "mercedes", active: true },
  { code: "ANT", number: 12, name: "Andrea Kimi Antonelli", constructorKey: "mercedes", active: true },
  { code: "VER", number: 3, name: "Max Verstappen", constructorKey: "red-bull-racing", active: true },
  { code: "HAD", number: 6, name: "Isack Hadjar", constructorKey: "red-bull-racing", active: true },
  { code: "LEC", number: 16, name: "Charles Leclerc", constructorKey: "ferrari", active: true },
  { code: "HAM", number: 44, name: "Lewis Hamilton", constructorKey: "ferrari", active: true },
  { code: "SAI", number: 55, name: "Carlos Sainz Jr.", constructorKey: "williams", active: true },
  { code: "ALB", number: 23, name: "Alexander Albon", constructorKey: "williams", active: true },
  { code: "LAW", number: 30, name: "Liam Lawson", constructorKey: "racing-bulls", active: true },
  { code: "LIN", number: 41, name: "Arvid Lindblad", constructorKey: "racing-bulls", active: true },
  { code: "ALO", number: 14, name: "Fernando Alonso", constructorKey: "aston-martin", active: true },
  { code: "STR", number: 18, name: "Lance Stroll", constructorKey: "aston-martin", active: true },
  { code: "OCO", number: 31, name: "Esteban Ocon", constructorKey: "haas", active: true },
  { code: "BEA", number: 87, name: "Oliver Bearman", constructorKey: "haas", active: true },
  { code: "HUL", number: 27, name: "Nico Hülkenberg", constructorKey: "audi", active: true },
  { code: "BOR", number: 5, name: "Gabriel Bortoleto", constructorKey: "audi", active: true },
  { code: "GAS", number: 10, name: "Pierre Gasly", constructorKey: "alpine", active: true },
  { code: "COL", number: 43, name: "Franco Colapinto", constructorKey: "alpine", active: true },
  { code: "PER", number: 11, name: "Sergio Pérez", constructorKey: "cadillac", active: true },
  { code: "BOT", number: 77, name: "Valtteri Bottas", constructorKey: "cadillac", active: true },
];

export const F1_2026_DRIVER_CODES: ReadonlySet<string> = new Set(F1_DRIVERS_2026.map((driver) => driver.code));
