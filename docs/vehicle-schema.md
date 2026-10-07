# Vehicle Profile Schema

Status: **implemented (Phase 0)** · Schema version: `1`

This is the canonical shape of a Log2Dyno vehicle profile. It is consumed by the
picker and the dyno math, served by `GET /api/cars`, and written only to the user
garage by `POST /api/save-car`.

## Storage layout

| Location | Role | Writable |
|---|---|---|
| `server/data/cars/index.json` | Catalog manifest (`schemaVersion`, ordered `files` list) | no |
| `server/data/cars/<make>.json` | Bundled, read-only catalog entries (JSON arrays) | no |
| `data/cars.json` (Docker: `/app/data/cars.json`) | User "garage" — custom and cloned vehicles | yes |

`GET /api/cars` returns **catalog ∪ garage**. The catalog is authoritative: if a
garage row has the same `id` as a catalog row, the catalog row wins and the garage
duplicate is ignored. This prevents a stale seed copy from shadowing a built-in
profile. Every row is tagged with `origin`:

- `origin: "catalog"` — built in, immutable via the API
- `origin: "user"` — from the garage, editable/deletable

The loader is implemented in `server/carCatalog.js`.

## Fields

`*` = required. Numbers are US customary because the dyno math is in lb / in / sq ft.

| Field | Type | Notes |
|---|---|---|
| `id` * | string | Stable unique key. Built-ins keep their original ids; new cars use `buildCarId()` or `car_<time><rand>`. |
| `name` * | string | Display name, e.g. `2011-2014 Ford Mustang GT 5.0 [6MT]`. |
| `make` * | string | Grouping key for the picker (`Custom` for editor-created cars). |
| `model` * | string | |
| `trim` | string | Free-text sub-model (e.g. `Z06`, `GT 5.0`). |
| `generation` | string | Optional chassis code (`S197`, `C7`, `CT9A`). |
| `yearStart` / `yearEnd` | number | Four-digit model years. |
| `bodyStyle` | string | Optional (`Coupe`, `Sedan`, `Wagon`, …). |
| `drive` | string | Optional (`RWD`, `AWD`, `FWD`). |
| `transmission` | object | `{ type, speeds, code? }`. `type` ∈ `manual`, `automatic`, `dct`, `cvt`, `single`. |
| `weightLbs` * | number | Curb weight. |
| `occupantWeightLbs` | number | Driver + passengers; defaults to 170 at authoring time. |
| `tireDiameterInches` * | number | Loaded tire diameter. |
| `tireSize` | string | Optional source string, e.g. `275/40R19`. |
| `finalDrive` * | number | Final drive (axle) ratio. |
| `gears` * | object | `{ "1": ratio, "2": ratio, … }`, keyed by gear number. |
| `defaultGear` | number | Gear to preselect; must exist in `gears`. |
| `dragCoefficient` | number | Cd. |
| `frontalAreaSqFt` | number | Frontal area. |
| `dynoType` | string | `dynojet` \| `mustang` \| `virtualdyno`. |
| `smoothing` | number | 0–10; dyno (HP/TQ) smoothing. |
| `gearDataComplete` | boolean | `false` when only the dyno-pull gears (3rd/4th) are known. |
| `dataConfidence` | string | `measured` \| `estimated` \| `mixed`. |
| `source` | object | `{ kind, file?, note? }` provenance. |
| `origin` | string | **Injected at load/merge time** — do not store in files. |

### Fields the dyno math actually reads

`weightLbs`, `occupantWeightLbs`, `extraWeightLbs` (per-run), `gearRatio`
(derived client-side from the selected gear), `finalDrive`, `tireDiameterInches`,
`dragCoefficient`, `frontalAreaSqFt`, `dynoType`, `smoothing`, `gear`. All other
fields are metadata for the picker and future features, so adding them is safe.

## Id and naming rules

- `buildCarId(car)` → `slugify("{make} {model} {trim} {yearStart} {yearEnd} {nMT}")`,
  e.g. `ford-mustang-gt-5-0-2011-2014-6mt`.
- `buildDisplayName(car)` → `"{yearStart}[-{yearEnd}] {make} {model} {trim} [{nMT}]"`.
- Transmission abbreviations: `MT`, `AT`, `DCT`, `CVT`, `Single Speed`.

## Gear rules

- At least one ratio is required; values must be positive.
- Ratios normally **decrease** as the gear number rises. An equal or increasing
  consecutive ratio is a **warning**, not an error: gearboxes with split final drives
  (e.g. VW 02Q, 1–4 vs 5–6) legitimately raise the raw ratio at 5th.
- Gear numbers should be contiguous from `1`; gaps are a warning.
- `defaultGear` must be one of the declared gears.
- EVs / single-speed drivetrains use `transmission.type: "single"` with
  `gears: { "1": 1.0 }`; the UI then renders one "Single Speed" option instead of a
  gear list.

## Validation levels

`validateCar(car)` returns `{ valid, errors, warnings }`:

- **Errors** (block saving / skip a catalog entry): missing required fields,
  non-numeric or non-positive ratios, unknown `defaultGear`, unknown
  `transmission.type`, malformed years.
- **Warnings** (never block): values outside generous sanity ranges
  (`weightLbs` 800–8000, `dragCoefficient` 0.10–1.00, `frontalAreaSqFt` 10–50,
  `tireDiameterInches` 15–40, `finalDrive` 1.5–8.0, gear ratios 0.2–8.0),
  non-contiguous gears, equal/increasing consecutive ratios, single-speed with ≠1 gear.

The catalog loader skips invalid entries (collecting the reason) rather than failing
the whole catalog, so one bad car can never take down the vehicle list.

## Save / delete semantics

- `POST /api/save-car` validates, normalizes minimal editor payloads
  (`server/carCatalog.js` `normalizeCarInput` fills `make`, `model`, `transmission`,
  and single-year ranges), then writes **only to the garage**.
- Saving over a built-in catalog id **clones** the profile into the garage under a
  fresh id (`cloned: true` in the response). The catalog entry is never modified.
- `POST /api/delete-car` refuses built-in catalog ids (`400`, code
  `CATALOG_IMMUTABLE`) and deletes only garage entries.
- A corrupt garage file degrades gracefully: `GET /api/cars` serves catalog-only and
  logs a warning instead of failing.

## Example

```jsonc
{
  "id": "ford-mustang-gt-5-0-2011-2014-6mt",
  "name": "2011-2014 Ford Mustang GT 5.0 [6MT]",
  "make": "Ford",
  "model": "Mustang",
  "trim": "GT 5.0",
  "generation": "S197",
  "yearStart": 2011,
  "yearEnd": 2014,
  "bodyStyle": "Coupe",
  "drive": "RWD",
  "transmission": { "type": "manual", "speeds": 6, "code": "MT-82" },
  "weightLbs": 3600,
  "occupantWeightLbs": 170,
  "tireDiameterInches": 27.2,
  "finalDrive": 3.31,
  "gears": { "1": 3.66, "2": 2.43, "3": 1.69, "4": 1.32, "5": 1.0, "6": 0.65 },
  "defaultGear": 3,
  "dragCoefficient": 0.37,
  "frontalAreaSqFt": 24.0,
  "dynoType": "dynojet",
  "smoothing": 4,
  "gearDataComplete": true,
  "dataConfidence": "measured",
  "source": { "kind": "virtualdyno", "file": "Ford/Mustang/Mustang_GT_11-13.xml" }
}
```
