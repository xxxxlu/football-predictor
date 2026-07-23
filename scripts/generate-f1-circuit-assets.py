#!/usr/bin/env python3
"""Generate the current 2026 F1 circuit SVG set and the TypeScript path index.

Source data is vendored from bacinger/f1-circuits (MIT). The checked-in source
keeps this build offline and reproducible.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "apps/web/src/app/design-system/data/f1-circuits.geojson"
OUTPUT_DIR = ROOT / "apps/web/public/design-system/f1/circuits"
TS_OUTPUT = ROOT / "apps/web/src/app/design-system/circuits.ts"

# The live official calendar on 2026-07-17 contains 22 rounds. Bahrain and
# Saudi Arabia are intentionally absent from the current calendar snapshot.
CALENDAR = [
    ("albert-park", "au-1953", "Australia", "Australian Grand Prix"),
    ("shanghai", "cn-2004", "China", "Chinese Grand Prix"),
    ("suzuka", "jp-1962", "Japan", "Japanese Grand Prix"),
    ("miami", "us-2022", "United States", "Miami Grand Prix"),
    ("montreal", "ca-1978", "Canada", "Canadian Grand Prix"),
    ("monaco", "mc-1929", "Monaco", "Monaco Grand Prix"),
    ("catalunya", "es-1991", "Spain", "Barcelona-Catalunya Grand Prix"),
    ("red-bull-ring", "at-1969", "Austria", "Austrian Grand Prix"),
    ("silverstone", "gb-1948", "Great Britain", "British Grand Prix"),
    ("spa", "be-1925", "Belgium", "Belgian Grand Prix"),
    ("hungaroring", "hu-1986", "Hungary", "Hungarian Grand Prix"),
    ("zandvoort", "nl-1948", "Netherlands", "Dutch Grand Prix"),
    ("monza", "it-1922", "Italy", "Italian Grand Prix"),
    ("madring", "es-2026", "Spain", "Spanish Grand Prix"),
    ("baku", "az-2016", "Azerbaijan", "Azerbaijan Grand Prix"),
    ("marina-bay", "sg-2008", "Singapore", "Singapore Grand Prix"),
    ("cota", "us-2012", "United States", "United States Grand Prix"),
    ("mexico-city", "mx-1962", "Mexico", "Mexico City Grand Prix"),
    ("interlagos", "br-1940", "Brazil", "São Paulo Grand Prix"),
    ("las-vegas", "us-2023", "United States", "Las Vegas Grand Prix"),
    ("lusail", "qa-2004", "Qatar", "Qatar Grand Prix"),
    ("yas-marina", "ae-2009", "United Arab Emirates", "Abu Dhabi Grand Prix"),
]


def perpendicular_distance(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> float:
    if start == end:
        return math.dist(point, start)
    x, y = point
    x1, y1 = start
    x2, y2 = end
    return abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / math.hypot(y2 - y1, x2 - x1)


def simplify(points: list[tuple[float, float]], epsilon: float) -> list[tuple[float, float]]:
    if len(points) < 3:
        return points
    index, maximum = 0, 0.0
    for i in range(1, len(points) - 1):
        distance = perpendicular_distance(points[i], points[0], points[-1])
        if distance > maximum:
            index, maximum = i, distance
    if maximum <= epsilon:
        return [points[0], points[-1]]
    left = simplify(points[: index + 1], epsilon)
    right = simplify(points[index:], epsilon)
    return left[:-1] + right


def project(coordinates: list[list[float]]) -> list[tuple[float, float]]:
    latitude = sum(point[1] for point in coordinates) / len(coordinates)
    cos_lat = math.cos(math.radians(latitude))
    raw = [(lon * cos_lat, -lat) for lon, lat in coordinates]
    min_x = min(point[0] for point in raw)
    max_x = max(point[0] for point in raw)
    min_y = min(point[1] for point in raw)
    max_y = max(point[1] for point in raw)
    width, height, margin = 400.0, 320.0, 24.0
    scale = min((width - 2 * margin) / (max_x - min_x), (height - 2 * margin) / (max_y - min_y))
    offset_x = (width - (max_x - min_x) * scale) / 2
    offset_y = (height - (max_y - min_y) * scale) / 2
    fitted = [((x - min_x) * scale + offset_x, (y - min_y) * scale + offset_y) for x, y in raw]
    closed = math.dist(fitted[0], fitted[-1]) < 2
    body = fitted[:-1] if closed else fitted
    reduced = simplify(body, 1.15)
    if closed:
        reduced.append(reduced[0])
    return reduced


def path_data(points: list[tuple[float, float]]) -> str:
    commands = [f"M{points[0][0]:.1f},{points[0][1]:.1f}"]
    commands.extend(f"L{x:.1f},{y:.1f}" for x, y in points[1:])
    if points[0] == points[-1]:
        commands.append("Z")
    return " ".join(commands)


def main() -> None:
    data = json.loads(SOURCE.read_text())
    by_id = {feature["properties"]["id"]: feature for feature in data["features"]}
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    generated: list[dict[str, object]] = []

    for round_number, (key, source_id, country, grand_prix) in enumerate(CALENDAR, start=1):
        feature = by_id[source_id]
        properties = feature["properties"]
        points = project(feature["geometry"]["coordinates"])
        path = path_data(points)
        start_x, start_y = points[0]
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 320" role="img" aria-labelledby="title">
  <title id="title">{properties["Name"]}</title>
  <path d="{path}" fill="none" stroke="#ef4d2f" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="{start_x:.1f}" cy="{start_y:.1f}" r="5" fill="#d9ff16"/>
</svg>
'''
        (OUTPUT_DIR / f"{key}.svg").write_text(svg)
        generated.append(
            {
                "key": key,
                "round": round_number,
                "sourceId": source_id,
                "country": country,
                "gp": grand_prix,
                "name": properties["Name"],
                "path": path,
                "asset": f"/design-system/f1/circuits/{key}.svg",
            }
        )

    lines = [
        "/* Generated by scripts/generate-f1-circuit-assets.py.",
        "   Source: bacinger/f1-circuits (MIT), snapshot 394d8fbe70ef2c0b0c8d23ff7bee61fa09606055. */",
        "",
        "export const CIRCUITS = {",
    ]
    for item in generated:
        lines.extend(
            [
                f'  "{item["key"]}": {{',
                f'    round: {item["round"]},',
                f'    sourceId: "{item["sourceId"]}",',
                f'    country: "{item["country"]}",',
                f'    gp: "{item["gp"]}",',
                f'    name: "{item["name"]}",',
                f'    asset: "{item["asset"]}",',
                f'    path: "{item["path"]}",',
                "  },",
            ]
        )
    lines.extend(["} as const;", "", "export type CircuitKey = keyof typeof CIRCUITS;", ""])
    TS_OUTPUT.write_text("\n".join(lines))
    print(f"generated {len(generated)} circuit SVGs and {TS_OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
