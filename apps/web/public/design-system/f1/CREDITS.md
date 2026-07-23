# PULSE 2026 F1 asset credits

Snapshot generated on 2026-07-17 for the design-system prototype.

## Scope

- 22 circuits from the current official 2026 Formula 1 calendar.
- 11 current 2026 constructors/chassis.
- 22 drivers from the current FIA 2026 entry list.

## Circuits

Circuit geometry is derived from `bacinger/f1-circuits` at commit
`394d8fbe70ef2c0b0c8d23ff7bee61fa09606055` and rendered locally as SVG.
The source dataset is MIT licensed. Its license is preserved at
`apps/web/src/app/design-system/data/f1-circuits-LICENSE.md`.

## Cars and drivers

The current AVIF media pack was supplied locally for this prototype. The
filenames are mapped to driver, constructor, and chassis slugs in
`assets-manifest.json`. Add the final photographer/source/license fields to
that manifest before public release; the UI labels these files `LOCAL ASSET`
until then.

## Refresh

```sh
python3 scripts/generate-f1-circuit-assets.py
python3 scripts/sync-f1-media-assets.py
```

Review the generated gallery at `/design-system/f1-assets` before publishing.
