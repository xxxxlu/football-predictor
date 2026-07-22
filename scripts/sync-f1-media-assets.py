#!/usr/bin/env python3
"""Download a license-audited 2026 F1 driver and car media set from Commons.

The script only accepts CC BY, CC BY-SA, CC0 and public-domain files. It stores
the exact source page, author and license in assets-manifest.json so every local
file remains traceable.
"""

from __future__ import annotations

import html
import hashlib
import json
import mimetypes
import re
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ROOT = ROOT / "apps/web/public/design-system/f1"
MANIFEST_PATH = PUBLIC_ROOT / "assets-manifest.json"
API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "PULSE-Sports-Club-asset-sync/1.0 (local design prototype)"
CACHE_DIR = Path("/private/tmp/pulse-f1-commons-cache")
LAST_REQUEST_AT = 0.0

DRIVERS = [
    ("lando-norris", 1, "Lando Norris", "McLaren", "Category:Lando Norris in 2026"),
    ("oscar-piastri", 81, "Oscar Piastri", "McLaren", "Category:Oscar Piastri in 2026"),
    ("george-russell", 63, "George Russell", "Mercedes", "Category:George Russell in 2026"),
    ("kimi-antonelli", 12, "Andrea Kimi Antonelli", "Mercedes", "Category:Andrea Kimi Antonelli in 2026"),
    ("max-verstappen", 3, "Max Verstappen", "Red Bull Racing", "Category:Max Verstappen (racing driver) in 2026"),
    ("isack-hadjar", 6, "Isack Hadjar", "Red Bull Racing", "Category:Isack Hadjar in 2026"),
    ("charles-leclerc", 16, "Charles Leclerc", "Ferrari", "Category:Charles Leclerc in 2026"),
    ("lewis-hamilton", 44, "Lewis Hamilton", "Ferrari", "Category:Lewis Hamilton in 2026"),
    ("carlos-sainz", 55, "Carlos Sainz Jr.", "Williams", "Category:Carlos Sainz, Jr. in 2026"),
    ("alexander-albon", 23, "Alexander Albon", "Williams", "Category:Alexander Albon in 2026"),
    ("liam-lawson", 30, "Liam Lawson", "Racing Bulls", "Category:Liam Lawson in 2026"),
    ("arvid-lindblad", 41, "Arvid Lindblad", "Racing Bulls", "Category:Arvid Lindblad in 2026"),
    ("fernando-alonso", 14, "Fernando Alonso", "Aston Martin", "Category:Fernando Alonso in 2026"),
    ("lance-stroll", 18, "Lance Stroll", "Aston Martin", "Category:Lance Stroll in 2026"),
    ("esteban-ocon", 31, "Esteban Ocon", "Haas", "Category:Esteban Ocon in 2026"),
    ("oliver-bearman", 87, "Oliver Bearman", "Haas", "Category:Oliver Bearman in 2026"),
    ("nico-hulkenberg", 27, "Nico Hülkenberg", "Audi", "Category:Nico Hülkenberg in 2026"),
    ("gabriel-bortoleto", 5, "Gabriel Bortoleto", "Audi", "Category:Gabriel Bortoleto in 2026"),
    ("pierre-gasly", 10, "Pierre Gasly", "Alpine", "Category:Pierre Gasly in 2026"),
    ("franco-colapinto", 43, "Franco Colapinto", "Alpine", "Category:Franco Colapinto in 2026"),
    ("sergio-perez", 11, "Sergio Pérez", "Cadillac", "Category:Sergio Pérez in 2026"),
    ("valtteri-bottas", 77, "Valtteri Bottas", "Cadillac", "Category:Valtteri Bottas in 2026"),
]

CARS = [
    ("mclaren-mcl40", "McLaren", "MCL40", "Category:McLaren MCL40"),
    ("mercedes-w17", "Mercedes", "W17", "Category:Mercedes-AMG F1 W17 E Performance"),
    ("red-bull-rb22", "Red Bull Racing", "RB22", "Category:Red Bull RB22"),
    ("ferrari-sf26", "Ferrari", "SF-26", "Category:Ferrari SF-26"),
    ("williams-fw48", "Williams", "FW48", "Category:Williams FW48"),
    ("racing-bulls-vcarb03", "Racing Bulls", "VCARB 03", "Category:RB VCARB 03"),
    ("aston-martin-amr26", "Aston Martin", "AMR26", "Category:Aston Martin AMR26"),
    ("haas-vf26", "Haas", "VF-26", "Category:Haas VF-26"),
    ("audi-r26", "Audi", "R26", "Category:Audi R26"),
    ("alpine-a526", "Alpine", "A526", "Category:Alpine A526"),
    ("cadillac-mac26", "Cadillac", "MAC-26", "Category:Cadillac MAC-26"),
]

# Commons categories are useful for discovery, but some year categories only
# contain on-track car photos. Pin a verified driver portrait for those cases.
DRIVER_PORTRAIT_OVERRIDES = {
    "esteban-ocon": "File:Esteban Ocon 2024 Suzuka (cropped).jpg",
    "nico-hulkenberg": "File:Nico Hulkenberg 2017 Malaysia.jpg",
    "pierre-gasly": "File:Pierre Gasly 2017 Malaysia.jpg",
    "sergio-perez": "File:2024-08-25 Motorsport, Formel 1, Großer Preis der Niederlande 2024 STP 3758 by Stepro (cropped).jpg",
}


def api_request(params: dict[str, str]) -> dict:
    global LAST_REQUEST_AT
    query = {"format": "json", "formatversion": "2", **params}
    url = f"{API}?{urllib.parse.urlencode(query)}"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{hashlib.sha256(url.encode()).hexdigest()}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text())

    for attempt in range(8):
        elapsed = time.monotonic() - LAST_REQUEST_AT
        if elapsed < 0.85:
            time.sleep(0.85 - elapsed)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.load(response)
            LAST_REQUEST_AT = time.monotonic()
            cache_file.write_text(json.dumps(payload))
            return payload
        except urllib.error.HTTPError as error:
            LAST_REQUEST_AT = time.monotonic()
            if error.code != 429 or attempt == 7:
                raise
            retry_after = int(error.headers.get("Retry-After", "0") or 0)
            time.sleep(max(retry_after, 4 * (attempt + 1)))
    raise RuntimeError(f"Commons API retries exhausted: {url}")


def category_members(category: str, depth: int = 2) -> list[str]:
    files: set[str] = set()
    visited: set[str] = set()

    def visit(title: str, remaining: int) -> None:
        if title in visited:
            return
        visited.add(title)
        continuation = ""
        while True:
            params = {
                "action": "query",
                "list": "categorymembers",
                "cmtitle": title,
                "cmtype": "file|subcat",
                "cmlimit": "500",
            }
            if continuation:
                params["cmcontinue"] = continuation
            payload = api_request(params)
            for member in payload.get("query", {}).get("categorymembers", []):
                member_title = member["title"]
                if member_title.startswith("File:"):
                    files.add(member_title)
                elif remaining > 0 and member_title.startswith("Category:"):
                    visit(member_title, remaining - 1)
            continuation = payload.get("continue", {}).get("cmcontinue", "")
            if not continuation:
                break

    visit(category, depth)
    return sorted(files)


def image_info(titles: list[str]) -> list[dict]:
    results: list[dict] = []
    for start in range(0, len(titles), 40):
        payload = api_request(
            {
                "action": "query",
                "titles": "|".join(titles[start : start + 40]),
                "prop": "imageinfo",
                "iiprop": "url|size|mime|extmetadata",
                "iiurlwidth": "1600",
            }
        )
        for page in payload.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [None])[0]
            if info:
                results.append({"title": page["title"], **info})
    return results


def clean(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def metadata_value(info: dict, key: str) -> str:
    return clean(info.get("extmetadata", {}).get(key, {}).get("value"))


def allowed(info: dict) -> bool:
    license_name = metadata_value(info, "LicenseShortName").lower()
    return any(token in license_name for token in ("cc by", "cc0", "public domain"))


def choose(infos: list[dict], kind: str, subject: str) -> dict | None:
    subject_tokens = [token.lower() for token in re.findall(r"[A-Za-z0-9]+", subject) if len(token) > 2]
    candidates = []
    for info in infos:
        mime = info.get("mime", "")
        width, height = int(info.get("width", 0)), int(info.get("height", 0))
        title = info["title"].lower()
        if not allowed(info) or mime not in {"image/jpeg", "image/png", "image/webp"} or min(width, height) < 480:
            continue
        if kind == "driver":
            vehicle_markers = (
                "helmet", "signature", "logo", "monoposto", "f1 austria 2026 nr.",
                "- fp1", "- qualifying", " enters ", " exits ", " approaches ",
                "mclaren mcl", "ferrari sf-", "audi r26", "alpine a526", "haas vf-",
                "williams fw", "red bull rb", "racing bulls vcarb", "mercedes w17",
                "aston martin amr", "cadillac mac-",
            )
            if any(marker in title for marker in vehicle_markers):
                continue
        ratio = width / max(height, 1)
        target = 0.78 if kind == "driver" else 1.65
        score = abs(ratio - target)
        score -= 0.7 if "2026" in title else 0
        score -= 0.25 * sum(token in title for token in subject_tokens)
        if kind == "driver" and any(marker in title for marker in ("cropped", "melbourne walk", "fan zone", "portrait", "podium", "festival")):
            score -= 0.8
        score += 1.2 if kind == "driver" and ratio > 1.45 else 0
        score += 1.2 if kind == "car" and ratio < 1.15 else 0
        candidates.append((score, -width * height, info))
    return min(candidates, default=(0, 0, None), key=lambda item: (item[0], item[1]))[2]


def fallback_categories(category: str) -> list[str]:
    categories = [category]
    if " in 2026" in category:
        categories.append(category.replace(" in 2026", " in 2025"))
        categories.append(category.replace(" in 2026", ""))
    return categories


def extension(info: dict) -> str:
    mime = info.get("mime", "")
    return {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}.get(mime, mimetypes.guess_extension(mime) or ".img")


def download(subject: dict, info: dict, folder: str, category_used: str) -> dict:
    target_dir = PUBLIC_ROOT / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{subject['slug']}{extension(info)}"
    media_url = info.get("thumburl") or info["url"]
    if not target.exists():
        for attempt in range(8):
            request = urllib.request.Request(media_url, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    target.write_bytes(response.read())
                break
            except urllib.error.HTTPError as error:
                if error.code != 429 or attempt == 7:
                    raise
                retry_after = int(error.headers.get("Retry-After", "0") or 0)
                time.sleep(max(retry_after, 5 * (attempt + 1)))
    return {
        **subject,
        "status": "downloaded",
        "localPath": f"/design-system/f1/{folder}/{target.name}",
        "category": category_used,
        "sourceTitle": info["title"],
        "sourcePage": info.get("descriptionurl", ""),
        "sourceUrl": info.get("url", ""),
        "downloadUrl": media_url,
        "width": info.get("thumbwidth") or info.get("width"),
        "height": info.get("thumbheight") or info.get("height"),
        "mime": info.get("mime", ""),
        "license": metadata_value(info, "LicenseShortName"),
        "licenseUrl": metadata_value(info, "LicenseUrl"),
        "artist": metadata_value(info, "Artist"),
        "credit": metadata_value(info, "Credit"),
    }


def collect(entries: list[tuple], kind: str) -> list[dict]:
    output: list[dict] = []
    for entry in entries:
        if kind == "driver":
            slug, number, name, team, category = entry
            subject = {"slug": slug, "number": number, "name": name, "team": team}
            subject_name = name
            folder = "drivers"
        else:
            slug, team, chassis, category = entry
            subject = {"slug": slug, "team": team, "chassis": chassis}
            subject_name = chassis
            folder = "cars"

        selected = None
        category_used = category
        checked = []
        if kind == "driver" and subject["slug"] in DRIVER_PORTRAIT_OVERRIDES:
            pinned_title = DRIVER_PORTRAIT_OVERRIDES[subject["slug"]]
            pinned_infos = image_info([pinned_title])
            selected = choose(pinned_infos, kind, subject_name)
            if selected:
                category_used = "Verified portrait override"

        for candidate_category in fallback_categories(category) if not selected else []:
            checked.append(candidate_category)
            titles = category_members(candidate_category, depth=1 if kind == "driver" else 2)
            selected = choose(image_info(titles), kind, subject_name) if titles else None
            if selected:
                category_used = candidate_category
                break
            time.sleep(0.15)

        if selected:
            result = download(subject, selected, folder, category_used)
            print(f"{kind}: {subject_name} <- {selected['title']}")
        else:
            result = {**subject, "status": "missing", "categoriesChecked": checked}
            print(f"{kind}: {subject_name} MISSING")
        output.append(result)
    return output


def main() -> None:
    PUBLIC_ROOT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "season": 2026,
        "policy": "Only CC BY, CC BY-SA, CC0 and public-domain Wikimedia Commons files are accepted.",
        "officialEntryList": "https://www.fia.com/sites/default/files/guide_media_2026_2_0.pdf",
        "drivers": collect(DRIVERS, "driver"),
        "cars": collect(CARS, "car"),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    downloaded = sum(item["status"] == "downloaded" for group in (manifest["drivers"], manifest["cars"]) for item in group)
    missing = 33 - downloaded
    print(f"wrote {MANIFEST_PATH.relative_to(ROOT)}: {downloaded} downloaded, {missing} missing")


if __name__ == "__main__":
    main()
