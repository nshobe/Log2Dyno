# Vehicle Database Expansion Plan

Status: **IN PROGRESS — Phase 0 (storage/schema refactor) complete; Phase 1 next**
Owner: Log2Dyno
Goal: Grow the vehicle catalog from 3 hand-written profiles to **≥ 277 entries
(Virtual Dyno parity)** plus a curated set of popular sports cars, without turning
`cars.json` into an unmaintainable blob and without losing the current dyno math.

> This document is written to be self-sufficient if work is stopped mid-stream.
> Each phase has a checklist. Update checkboxes and the "Progress log" as work lands.

---

## 1. Why

Today the app ships **3 vehicle profiles** (`server/cars.json`) and the vehicle picker
is a single flat `<select>` repeated in three places (Run A, Run B, Manage Vehicles).
That is fine for a demo, but:

- Users of the original Virtual Dyno expect its car list. The Wine install on this
  machine has **277 `CarParameters` entries across 162 XML files / 25 makes**.
- A 300–600 entry flat dropdown is unusable; selection needs hierarchy + search.
- Storing everything in one `cars.json` is technically fine at this size (< 500 KB)
  but is bad for git diffs/review and conflicts when many cars are added.
- There is a **Docker seeding bug**: the tracked catalog is `server/cars.json`, but
  the Dockerfile sets `CARS_FILE=/app/data/cars.json`, so a fresh container seeds the
  volume with the single `DEFAULT_CARS` entry and never sees the real catalog.

The dyno math does not need to change: `calculateDyno` consumes a small, stable subset
of the profile (`weightLbs`, `occupantWeightLbs`, `gearRatio`, `finalDrive`,
`tireDiameterInches`, `dragCoefficient`, `frontalAreaSqFt`, `dynoType`, `smoothing`,
`gear`). New catalog metadata is purely additive.

---

## 2. Baseline findings (current code + Virtual Dyno data)

### 2.1 Repository (current, post-Phase 0)

| Item | Value |
|---|---|
| Bundled catalog | `server/data/cars/*.json` — read-only, `index.json` manifest (3 cars at Phase 0; 277+ after Phase 1) |
| User garage | `data/cars.json` (Docker `/app/data/cars.json`) — writable, user-only, gitignored |
| Loader | `server/carCatalog.js` — load / validate / merge, memoized |
| API | `GET /api/cars` = catalog ∪ garage (plain array, each row tagged `origin`); save/delete scoped to the garage |
| Docker | Catalog ships in the image; the volume holds only user data (fixes the single-car seed bug) |
| Frontend pickers | `#runACarSelect`, `#runBCarSelect`, `#carModalProfileSelect` — still flat (UI rework is Phase 3) |
| Gear picker | `populateGearSelect()` honors `defaultGear` and renders a "Single Speed" option for EVs |
| Persistence helper | `prefGet` / `prefSet` (localStorage, `log2dyno_*`) available for favorites/recent |

*Pre-Phase-0 baseline (for reference): `server/cars.json` held 3 tracked cars plus a
stale root-owned `data/cars.json`; the Dockerfile's `CARS_FILE` seeded the volume with a
single `DEFAULT_CARS` entry, so the real catalog never reached container users.*

### 2.2 Virtual Dyno dataset inventory

Parsed from
`~/.local/share/wineprefixes/virtualdyno/drive_c/users/nshobe/AppData/Roaming/Virtual Dyno/Cars`:

- **277 car entries**, 162 XML files, **25 makes**, model years **1990–2020**.
- **184 manual / 93 automatic.**
- Make distribution: BMW 44 (many 3-series variants), Ford 31,
  Subaru 33, Mitsubishi 34, Chevrolet 26, Mazda 16, Honda 15, Pontiac 13,
  Dodge 10, VW/Nissan 8, Infiniti 7, Audi 5, Scion/Hyundai 4, Toyota/Mini/Eagle 3,
  Volvo/Plymouth/Acura 2, Saturn/Saab/Holden/Cadillac 1.
- `Weight`, `FinalGearRatio`, `DragCoefficient`, `FrontalArea`, `TireDiameter` are
  populated on **all 277** entries.
- 3 logical duplicates (Pontiac GTO MT variants listed twice).

### 2.3 Critical data-completeness gap: gear ratios

Virtual Dyno stores `TransGear1`…`TransGear6`, but **usually only the two gears used
for a dyno pull (3rd and 4th)**:

| Gears stored | Entries |
|---|---|
| 2 gears | 193 |
| 3 gears | 52 |
| 4 gears | 26 |
| 5 gears | 1 |
| 6 gears | 5 |

- **229 / 277 lack 1st and 2nd.** 8 lack 4th.
- Consequence: importing VD as-is gives a correct 3rd/4th pull for most cars, but the
  in-app gear dropdown would show only those two gears — not the full transmission.

### 2.4 VD → Log2Dyno field mapping

| Virtual Dyno XML | Log2Dyno field | Notes |
|---|---|---|
| `CarMake` | `make` | |
| `CarModel` | `model` | VD model names are coarse (`Evolution`, `M3`, `Mustang`) |
| `CarSubModel` | `trim` | often empty; sometimes carries wheel size |
| `StartYear` / `EndYear` | `yearStart` / `yearEnd` | |
| `Weight` | `weightLbs` | always present |
| `TransTypeManual` | `transmission.type` | lossy: `false` = all automatics (AT/AMT/DCT/CVT) |
| `TransGear1`…`6` | `gears` | **incomplete — see 2.3** |
| `FinalGearRatio` | `finalDrive` | |
| `DragCoefficient` | `dragCoefficient` | |
| `FrontalArea` | `frontalAreaSqFt` | |
| `TireDiameter` | `tireDiameterInches` | |
| `Custom` (`true`) | `origin` hint | VD's "user-added" flag |
| *(absent)* | `occupantWeightLbs` | default **170** |
| *(absent)* | `dynoType` | default `dynojet` |
| *(absent)* | `smoothing` | default `4` |
| *(absent)* | `defaultGear` | 3 if present, else 4, else lowest available |
| *(absent)* | `id` | derived deterministic slug |

---

## 3. Target vehicle schema

Additive changes only; the current 3-field set remains valid. Proposed canonical shape:

```jsonc
{
  "id": "ford-mustang-2011-2014-gt-5-0-mt",   // deterministic slug
  "name": "2011-2014 Ford Mustang GT 5.0 [6MT]", // denormalized for search/back-compat
  "make": "Ford",
  "model": "Mustang",
  "trim": "GT 5.0",
  "generation": "S197",                         // optional
  "yearStart": 2011,
  "yearEnd": 2014,
  "bodyStyle": "Coupe",                         // optional
  "drive": "RWD",                               // optional
  "transmission": {
    "type": "manual",                           // manual | automatic | dct | cvt | single
    "speeds": 6,
    "code": "MT-82"                             // optional, enables ratio presets
  },
  "weightLbs": 3600,
  "occupantWeightLbs": 170,
  "finalDrive": 3.31,
  "gears": { "1": 3.66, "2": 2.43, "3": 1.69, "4": 1.32, "5": 1.0, "6": 0.65 },
  "defaultGear": 3,
  "tireDiameterInches": 27.2,
  "tireSize": "255/40R19",                      // optional source of truth
  "dragCoefficient": 0.37,
  "frontalAreaSqFt": 24.0,
  "dynoType": "dynojet",
  "smoothing": 4,
  "origin": "catalog",                          // catalog | user
  "source": { "kind": "virtualdyno", "file": "Ford/Mustang/Mustang_GT_11-13.xml" },
  "gearDataComplete": true,                     // false when only 3rd/4th known
  "dataConfidence": "measured"                  // measured | estimated | mixed
}
```

Rules:
- `id` must be stable and unique; derived from make/model/trim/years/trans.
- `name` is generated as `"{yearStart}[-{yearEnd}] {make} {model} {trim} [{n}{MT|AT}]"`.
- EVs use `transmission.type: "single"`, `gears: {"1": 1.0}` and hide the gear picker.
- `dynoMath.js` is untouched; it already reads only the core numeric fields.

---

## 4. Storage architecture (the "one giant JSON" question)

**Recommendation: split a read-only bundled catalog from a small writable user garage.**

```
server/
  carCatalog.js              # loader + merge + validation, memoized at startup
  data/cars/
    index.json               # manifest: schema version, entry count, sources
    ford.json                # one file per make (reviewable diffs, no merge conflicts)
    chevrolet.json
    ...
data/cars.json               # user garage (Docker volume) — only user-created/overridden cars
```

- `carCatalog.js` reads every `server/data/cars/*.json` once, validates, merges, and
  memoizes in memory. ~500–700 entries ≈ 300 KB — trivial to load and merge.
- `GET /api/cars` returns **catalog ∪ garage**, with `origin` on every row.
- `save-car` / `delete-car` operate **only on the garage**. Catalog entries are
  immutable in-place; "edit" clones to the garage (clear UX copy explaining this).
  If true overrides are wanted later, add `overridesCatalog: true` + merge-by-id.
- Keep `CARS_FILE` working (garage path) for backward compatibility; add
  `CARS_CATALOG_DIR` (default `server/data/cars`) for the catalog.
- **Fixes the Docker bug**: the catalog always ships in the image; the volume only
  ever holds user profiles, so upgrades don't clobber user data and fresh installs
  get the full list.

Why not one file / why not SQLite:
- One `server/data/cars.catalog.json` would also work and is simpler to load, but a
  per-make split keeps diffs reviewable and avoids conflict when many makes are added
  in parallel. We can still emit a single generated file at build time if desired.
- SQLite (or any DB) is overkill for a static, read-mostly list; no new deps.

---

## 5. Import & validation pipeline

> **Status update — the importer has been retired.** §5.1 and §5.2 describe the
> one-time bootstrap that produced the catalog. It has been run to completion and
> `tools/import-virtualdyno.js` has been **deleted** (with its `npm run import-cars`
> script) so the data can never be silently clobbered. `server/data/cars/*.json` is
> now the canonical, hand-maintained catalog; `server/data/transmissions.json`,
> `gear-overrides.json` and `curated-cars.json` are retained as provenance only.
> Only §5.3 (`tools/validate-cars.js`) remains active. See the progress log (§13).

### 5.1 Importer — `tools/import-virtualdyno.js` (retired, deleted)

- Walk the VD `Cars/` tree, parse each `<CarParameters>` block, map fields per §2.4.
- Derive `id`, `name`, `trim`, `transmission.type/speeds`, `defaultGear`.
- **Gear backfill**: join against a curated `server/data/transmissions.json`
  (transmission code → full ratios) using `(make, model, years, manual/auto)` and the
  `TransGear3` value as a fingerprint. Where a match is found, fill the full gear set
  and set `gearDataComplete: true`; otherwise keep VD's ratios, set
  `gearDataComplete: false`, and mark the row for later backfill.
- Skip/mark `<Custom>true</Custom>` entries (VD user cars) so they don't masquerade
  as canonical data.
- De-duplicate the 3 known duplicate keys; prefer the entry with more complete gears.
- Emit one `server/data/cars/<make>.json` per make plus `index.json`.

### 5.2 Transmission presets — `server/data/transmissions.json` (provenance only)

Shared transmissions let us complete many cars at once. Initial set (~20–30):

- Ford: `MT-82`, `MT-82 D4`, `TR-3650`, `T5`, `6R80`, `10R80`
- GM: `T56`, `TR-6060`, `4L60E`, `4L80E`, `6L80`, `8L90`, `10L80`
- Chrysler: `TR-6060`, `8HP70`, `NAG1`
- Subaru: 5MT WRX, 6MT STI, `TR-690` (new WRX)
- Mitsubishi DSM 5MT AWD, Evo 5MT/6MT
- Nissan: 6MT `FS6R31A` (350Z/370Z), `GR6` DCT (GT-R R35)
- Honda: `AP1`/`AP2` 6MT (S2000), K-series 6MT
- Mazda: Miata 5MT/6MT, Mazdaspeed 6MT
- VW/Audi: `02M`/`02Q` 6MT, DSG `DQ250`/`DQ381`

Each preset is `{ code, speeds, type, ratios: {1..n} }`. Cars may override per-trim.

### 5.3 Validation — `tools/validate-cars.js` (run in `npm test`)

- Required: `id`, `name`, `make`, `model`, `weightLbs`, `finalDrive`,
  `tireDiameterInches`, `dragCoefficient`, `frontalAreaSqFt`, and `gears`.
- Sanity ranges: weight 1,500–6,500 lb; Cd 0.20–0.70; frontal area 15–40 sq ft;
  tire diameter 20–34 in; final drive 2.0–5.5; gear ratios 0.3–5.0.
- Gear ratios strictly decreasing with gear number; `defaultGear` exists and is ≤ top gear.
- Unique `id`; no duplicate `(make, model, trim, yearStart, yearEnd, transmission)`.
- Every `source.kind: "virtualdyno"` row appears in the catalog exactly once.
- `gearDataComplete: false` rows are allowed but count-reported (CI warning, not failure).

### 5.4 Attribution / licensing

The VD car dataset is community-contributed and distributed with Virtual Dyno
(Brad Barnhill). Before redistributing it in this repo, **verify the license /
redistribution terms** and add an attribution note (e.g. `server/data/cars/SOURCES.md`
and a README credit). This is an owner decision — see §11.

---

## 6. Curated additions beyond Virtual Dyno

VD is US-muscle-light and stops around 2020. The backlog below is prioritized by
demand and by how easily the required fields can be sourced. **Only add a car when we
have** weight, final drive, tire diameter, Cd, frontal area, and either a full gear set
or a known single-speed drivetrain. Missing Cd/frontal area can be estimated with
`frontalAreaSqFt ≈ 0.85 × width(ft) × height(ft)` and a `dataConfidence: "estimated"`
flag.

Rough sizing: Tier 1 ≈ 60, Tier 2 ≈ 55, Tier 3 ≈ 55, Tier 4 ≈ 10 → **~180 curated
entries**, for a catalog of **~450**, comfortably above VD's 277.

### Tier 1 — US muscle (highest demand)

| Make | Missing / thin coverage to add |
|---|---|
| Ford Mustang | 1987–1993 Fox 5.0 (T5); 1994–1998 SN95 GT/Cobra; 1999–2004 New Edge GT, Mach 1, Cobra; 2015–2017 GT 5.0 (**missing**); 2018–2023 GT gen3; GT350 2016–2020; GT500 2020–2022; Mach 1 2021–2023; Bullitt 2008–09 / 2019–20 |
| Chevrolet Camaro | 1993–2002 SS / Z28 LT1/LS1; 2010–2015 SS LS3/L99, ZL1 LSA, Z/28 LS7; 2016–2024 SS LT1, ZL1 LT4, 1LE |
| Chevrolet Corvette | C4 1985–1996 (L98/LT1/LT4/ZR-1); C5 Z06 2001–2004; C6 ZR1 LS9 + Grand Sport; C7 2014–2019 Stingray/Z51/Z06/ZR1; C8 2020+ Stingray/Z06 |
| Dodge | Challenger R/T 2011–2023, Scat Pack 392, Hellcat 2015+, Demon 2018; Charger R/T / SRT 392 / Hellcat; Viper SRT-10 2003–2010, Gen V 2013–2017 |
| Pontiac | Firebird / Trans Am LT1 & LS1 / WS6; Solstice GXP |
| Other | Ford Focus RS 2016–2018; Taurus SHO 2010–2019; F-150 Raptor (popular on dynos) |

### Tier 2 — JDM / import icons

| Make | Add |
|---|---|
| Nissan | 350Z (VQ35DE/HR); 370Z (VQ37VHR); GT-R R35 2013–2024; new Z 2023+; Skyline R32/R34 GT-R; SR20DET S13/S14 |
| Toyota | GR86 / BRZ 2022+; GR Corolla 2023+; MR2 Turbo SW20; Celica GT-Four ST185/ST205; Supra MK3 7M-GTE |
| Subaru | WRX 2015–2021 FA20DIT; WRX 2022+ FA24; STI 2015–2021; BRZ 2013–2020; Forester XT 2014–2018 |
| Mitsubishi | Evo VIII/IX full-ratio backfill; Evo X; 3000GT VR-4 (ratio backfill) |
| Honda / Acura | Civic Si 2017–2024; Civic Type R FK8/FL5; Integra Type R DC2/DC5; NSX NA1/NA2; NSX NC1 2017+ |
| Mazda | MX-5 NC 2006–2015 (**missing**); ND2 2019+ |

### Tier 3 — Euro sports

| Make | Add |
|---|---|
| BMW | E46 M3 S54; E36 M3; M2 (N55/S55); M5 E39/E60/F10; 340i/440i B58; Z4 M40i |
| Audi | B7 RS4; 8V S3/RS3 (DAZA); B9 S4/S5; R8 V10 |
| VW | GTI Mk5/Mk6/Mk7/Mk8; Golf R Mk7/Mk8 |
| Porsche | 911 993/996/997/991/992 (Carrera/Turbo/GT3); Cayman/Boxster 987/981/718 |
| Mercedes | C63 AMG W204 M156 / W205 M177; E55/E63 AMG; CLA45/A45 AMG |

### Tier 4 — EVs & special (requires `single` transmission support, Phase 0)

- Tesla Model 3 Performance, Model Y Performance, Model S Plaid.
- Optional: diesel trucks (very common on chassis dynos) as a later wave.

---

## 7. Vehicle selection UI redesign

Replace the three flat selects with a shared, grouped, searchable picker.

### Phase U1 — quick win (no new component)

- Populate options with `<optgroup label="{Make} ({count})">`, sorted
  make → model → yearStart → trim.
- Label: `2011-2014 Mustang GT 5.0 [6MT]` (drop the redundant make inside the group).
- Honor `defaultGear` when a car is selected.
- Add "★ Favorites" and "↺ Recent" optgroups at the top, persisted with
  `prefGet`/`prefSet` (`fav_cars`, `recent_cars`).

### Phase U2 — searchable combobox — ✅ COMPLETE (`public/vehiclePicker.js`)

- Dependency-free component (input + dropdown) shared by Run A, Run B and the modal.
- Type-to-search across make/model/trim/years/transmission code (`"2011 mustang gt"`,
  `"wrx 5mt"`, `"ls3 z51"`); token AND matching; show match count.
- Dropdown sections: ★ Favorites, ↺ Recent, then one group per make.
- Full keyboard support (↑/↓/Enter/Esc), ARIA combobox roles, touch-friendly.
- Selected value remains visible in the compact run card.

### Phase U3 — full browser in Manage Vehicles

- Cascading browse: **Make → Model → Generation/Year → Trim/Transmission**.
- Split the modal into **My Garage** (user, editable/deletable) and
  **Built-in Catalog** (read-only, "Save a copy to edit").
- Garage import/export (JSON), and a search box spanning both lists.

---

## 8. API & server changes

| Endpoint | Change |
|---|---|
| `GET /api/cars` | Keep returning a merged **array** (frontend stays compatible); add `origin`, `gearDataComplete`, `transmission`, display metadata per row |
| `POST /api/save-car` | Validate; write **garage only**; if the id belongs to the catalog, clone with a new user id (or store an override when that feature lands) |
| `POST /api/delete-car` | Refuse catalog ids; delete only garage entries |
| *(new, optional)* | `GET /api/cars?shape=v2` → `{ version, catalog, garage }` for the Phase U3 browser |
| Env | `CARS_FILE` = garage path (back-compat); `CARS_CATALOG_DIR` = catalog dir (default `server/data/cars`) |

---

## 9. Migration & backward compatibility

- Fold the existing 3 profiles (`sti_04_usdm`, `evo_06_ix`, `corvette_15_z06`) into
  the catalog under their makes; nothing the user saved is lost.
- Treat any existing `data/cars.json` as the starting garage; de-duplicate rows whose
  ids collide with the catalog.
- Frontend keeps consuming a plain array until Phase U2/U3; additive fields are ignored
  by old code paths.
- `dynoMath.js` and the normalized log-row contract are **not** touched.

---

## 10. Testing

- **Importer golden test**: parsing the VD tree yields exactly 277 entries (minus
  intentionally skipped `<Custom>` rows), with the expected make counts.
- **Validator test**: catches duplicate ids, non-monotonic gears, out-of-range values.
- **Catalog loader test**: per-make files merge correctly; garage overrides/dupes handled.
- **API test**: `GET /api/cars` includes catalog + garage; `delete-car` on a catalog id
  is refused; `save-car` validation rejects bad input.
- **Regression**: a known log + `sti_04_usdm` still produces the same curve as today.
- **Manual**: Run A/B gear dropdowns show the correct gears for a 6MT and an AT car;
  EV profile hides the gear picker.

---

## 11. Phases & checklist

### Phase 0 — Schema + storage refactor (no new cars) — ✅ COMPLETE
- [x] Define the target schema in `docs/vehicle-schema.md` and `server/carCatalog.js`.
- [x] Add `server/data/cars/` + `index.json`; move the 3 existing cars in
      (`subaru.json`, `mitsubishi.json`, `chevrolet.json`).
- [x] Loader merges catalog + garage; `GET /api/cars` adds `origin`.
- [x] `save-car`/`delete-car` scoped to garage; validation added
      (built-in ids are cloned on save and protected from deletion).
- [x] Fix Docker so the catalog ships and the volume holds only user data
      (default `CARS_FILE` → `data/cars.json`; catalog bundled under `server/data/cars/`).
- [x] Add `single` transmission type (EV) support, including UI gear-picker hiding.
- [x] Tests for loader/garage/API/EV path (`tests/cars.test.js`, 20 tests).

Implementation notes / deviations:
- `server/index.js` now exports `createServer(config)` so the API can be tested on an
  ephemeral port; it only `listen()`s when run directly.
- `.gitignore` `data/` was anchored to `/data/` — the unanchored pattern also ignored
  the new `server/data/` catalog directory.
- The existing garage (`data/cars.json`) is preserved; its colliding `sti_04_usdm` row
  is shadowed by the catalog copy and the two custom Z profiles remain as `origin: user`.
- `upsertGarageCar` normalizes minimal editor payloads (fills `make`/`model`/
  `transmission`) so the existing modal keeps saving without changes.
- Fixed local `data/` ownership (was root-owned, so `save-car` could not write).

### Phase 1 — Virtual Dyno import (parity: 277 entries) — ✅ COMPLETE
- [x] `tools/import-virtualdyno.js` + field mapping + slug/naming.
- [x] `server/data/transmissions.json` seed set (32 presets) + fingerprint gear backfill.
- [x] `tools/validate-cars.js` wired into `npm test` (`tests/import.test.js`).
- [x] Emit per-make catalog files (~25 makes) + `index.json`; no duplicates.
- [x] Attribution recorded in `server/data/cars/SOURCES.md` (public specifications;
      owner confirmed no licensing concern).

Result: **278 cars** (277 Virtual Dyno + 1 curated C7 Z06). **145** have complete
gear sets (137 backfilled from presets, 8 already complete in VD, plus curated);
**133** remain incomplete and are listed in `docs/gear-audit.md`.

Implementation notes / deviations:
- Added two new inputs beyond the plan: `server/data/gear-overrides.json`
  (per-vehicle research results, keyed by `file#index`) and
  `server/data/curated-cars.json` (hand-authored cars not in VD).
- **Non-monotonic gear ratios are warnings, not errors.** Real VD data (VW Golf R
  MK6 02Q) has 5th > 4th because the gearbox uses split final drives (1–4 vs 5–6);
  verified against VW/Car and Driver specs. Validator + `docs/vehicle-schema.md` updated.
- Preset matching is strict: make/type/year filters plus an exact ratio fingerprint on
  every gear VD provided. Zero ambiguous matches; the audit lists any future ones.
- The VD 2004-2006 STi is id-mapped back to `sti_04_usdm` via an override so the
  original default id and the garage row stay compatible.
- `npm run import-cars` / `npm run validate-cars` scripts added.

### Phase 2 — Curated Tier 1 + Tier 2 additions
- [ ] Add US muscle gaps (~60 entries; Mustang/Camaro/Corvette/Dodge/Pontiac).
- [ ] Add JDM icons (~55 entries).
- [ ] Backfill full gear ratios for all newly added rows.

### Phase 3 — Vehicle picker UI (U1 → U2 → U3)
- [ ] U1: optgroups + favorites/recent + honor `defaultGear`.
- [ ] U2: searchable combobox shared by both run cards.
- [ ] U3: cascading browser + Garage/Catalog split in Manage Vehicles.

### Phase 4 — Curated Tier 3 + Tier 4
- [ ] Euro sports (~55 entries).
- [ ] EV/single-speed profiles (~10 entries).

### Phase 5 — Polish
- [ ] Garage import/export; catalog version in `index.json`.
- [ ] README + docs updates; screenshots of the new picker.

---

## 12. Open questions / decisions needed

1. ~~**Redistribution**: are we allowed to ship the VD car dataset?~~ Resolved: owner
   confirmed the underlying vehicle specifications are public data and that the
   researched/derived catalog is fine to ship; attribution kept in `SOURCES.md`.
2. **Editing catalog cars**: clone-on-edit only, or support id-based overrides?
   (Clone-on-edit implemented; `gear-overrides.json` covers build-time data fixes.)
3. **Cd / frontal-area estimation tolerance**: is `dataConfidence: "estimated"`
   acceptable for cars without published aero figures?
4. **EV scope**: ship single-speed support now (Phase 0) or defer?
5. **Catalog packaging**: per-make files (proposed) vs a single generated
   `cars.catalog.json`.

---

## 13. Progress log

- 2026-XX-XX — Plan authored. Baseline measured: 3 app profiles; VD has 277 entries
  across 162 files / 25 makes (184 MT / 93 AT, 1990–2020); only 84/277 VD entries carry
  more than two gear ratios (193 carry exactly two).
- Phase 0 landed: `server/carCatalog.js` (load/validate/merge), `server/data/cars/`
  manifest + per-make files, `createServer()` export, garage-scoped save/delete with
  catalog protection, single-speed UI support, `docs/vehicle-schema.md`, and
  `tests/cars.test.js` (20 tests; full suite 51 → 52+ passing).
- Phase 1 landed: `tools/import-virtualdyno.js`, `tools/validate-cars.js`,
  `server/data/transmissions.json` (32 presets), `gear-overrides.json`,
  `curated-cars.json`, `SOURCES.md`, generated 278-car catalog, `docs/gear-audit.md`,
  `tests/import.test.js`. Full suite now **62 passing**. Remaining work is the per-car
  gear research listed in the audit (133 vehicles) and the Phase 2-4 additions.
- 2026-XX-XX — Gear backfill pass 1 (Phase 1 follow-up). Grew `transmissions.json`
  from 32 to **69 presets** and added one `gear-overrides.json` entry
  (Mitsubishi Ralliart = TC-SST DCT). Incomplete gear sets dropped **133 → 66**
  (complete 145 → **212 / 278**), with 0 ambiguous matches and 0 validator errors.
  New presets cover, among others: Ford Mustang Cobra/GT500/3.7/TR-6060 Falcon,
  BMW F8x + N55 (GS6-45BZ), Subaru 4EAT/5EAT, Mitsubishi Evo IX/X/MR, Galant VR-4,
  F5M42, Audi 0B1/DL501, Honda (Prelude H22, Integra GS-R, D/S1 cable, RSX K20,
  Civic Si K24Z7), Mazda (Protege FS, RX-7 FD, Miata ND 6MT), Toyota V160,
  Nissan FS6R31A (G35 6MT)/RS5F32A (G20), GM 6L80E/6L50/4T65E/AR5, VW 02J,
  Hyundai M6CF1 6MT + 6AT, Mini Getrag 252, and Ford B6/IB6 (Fiesta ST).
  Every preset is validated by strict ratio fingerprint against the VD-provided
  gears; unmatched/incomplete vehicles remain listed in `docs/gear-audit.md`.
  Full suite still **62 passing**.
  Remaining 66 incomplete: Mitsubishi 13, Chevrolet 8, Mazda 7, Volkswagen 6,
  Audi 4, Ford 4, Honda 4, Infiniti 4, BMW 3, Dodge 3, Hyundai 2, Mini 2,
  Subaru 2, Volvo 2, Pontiac 1, Saab 1.
- 2026-XX-XX — Gear backfill pass 2: **researched specs override conflicting VD data**.
  Where a VD-provided gear ratio conflicted with the manufacturer/published spec,
  the published value now wins, implemented as per-vehicle entries in
  `server/data/gear-overrides.json` (keyed by `<relative file>#<index>`). Added
  **36 new overrides**; incomplete gear sets dropped **66 → 30**, complete
  **212 → 248 / 278**; 0 validator errors; full suite **62 passing**.
  Notable conflict resolutions:
  - Infiniti G35 5AT → RE5R05A `3.540/2.264/1.471/1.000/0.834` (VD 3rd 1.417).
  - Audi B8 S4 S tronic → DL501 (0B5) 7-speed `3.692/2.238/1.559/1.175/0.915/0.745/0.617` (VD 1.406/1.025).
  - Chevrolet Silverado 4L60E/4L70E `3.059/1.625/1.000/0.696`, 4L80E `2.482/1.482/1.000/0.750` (VD rows inconsistent).
  - Chevrolet 1998-2002 Camaro V6 AT → 4L60E; 2010-2011 Camaro V6 MT → Aisin AY6 MV5 `4.48/2.58/1.63/1.19/1.00/0.75`; Cavalier → Getrag F23 M86 `3.58/2.02/1.35/0.98/0.69`.
  - Ford 2015-2016 Mustang EcoBoost MT-82 → `4.236/2.538/1.665/1.238/1.000/0.704` (VD duplicated 4th into 5th).
  - Hyundai Genesis Coupe 2.0T 6MT → M6CF1 `3.848/2.317/1.623/1.233/1.000/0.794` (VD 3rd 1.671).
  - Mini Cooper S (R53) Getrag 285 `3.308/2.130/1.483/1.139/0.949/0.816`.
  - Mitsubishi 3000GT VR-4 W5MG1 `3.071/1.739/1.103/0.824/0.660` / W6MG1 `3.266/1.904/1.241/0.918/0.733/0.589`; Eclipse GST F5M33; F5A51 5AT for Evo VII GTA / Airtrek / Galant VR-4 auto.
  - Audi RS4 B5 (01E), Audi TT RS (6MT), BMW GS6-37BZ/DZ, Mazda 6 V6 5MT, Mazda CX-7 AWD 6AT + FWD 5AT, Mazdaspeed3/Speed6, Pontiac G8 GXP (TR-6060), Saab 9-3 Aero (AF40-6), Subaru Legacy spec.B 6MT.
  - Subaru Impreza Outback Sport: VD marked it automatic but supplied the 5MT ratio
    set — corrected to `manual`.
  Remaining 30 incomplete (no confident published source yet): Volkswagen 6, Mitsubishi 5,
  Honda 4, Dodge 3, Ford 3, Infiniti 2, Mazda 2, Volvo 2, BMW 1, Chevrolet 1, Hyundai 1.
- 2026-XX-XX — Importer retired (option C). The Virtual Dyno import was a one-time
  bootstrap (VD is a frozen dataset), so `tools/import-virtualdyno.js` and the
  `npm run import-cars` script were **deleted** to make it impossible for anyone to
  regenerate/clobber the catalog. `server/data/cars/*.json` is now the canonical
  source of truth and is edited directly.
  - Kept: `tools/validate-cars.js` + `npm run validate-cars` (the ongoing safety net
    for adding/researching cars).
  - `tests/import.test.js` → replaced by `tests/catalog.test.js`, which keeps the
    catalog-level checks (validity, VD parity, unique ids, manifest integrity,
    contiguous `1..N` gear sets) and drops the deleted importer's unit tests.
  - `index.json` metadata updated (`generatedBy` → `derivedFrom`); `docs/gear-audit.md`
    is now a frozen snapshot with "edit the per-make file + validate" instructions.
  - Retained as provenance only (no code reads them): `transmissions.json`,
    `gear-overrides.json`, `curated-cars.json`.
- 2026-XX-XX — **Phase U2 landed: shared searchable vehicle picker.** Replaced the
  three flat 280-option `<select>`s (Run A, Run B, Manage Vehicles modal) with one
  dependency-free combobox, `public/vehiclePicker.js` (`createVehiclePicker`).
  - **Progressive enhancement**: the native `<select>` elements stay in the DOM as
    hidden value holders and still fire `change`, so no controller logic changed —
    every existing `.value` read and listener keeps working.
  - Dropdown sections: ★ Favorites, ↺ Recent (last 8), Your Garage, then one group per
    make with counts. Favorites/recent persist via `log2dyno_fav_cars` /
    `log2dyno_recent_cars`.
  - Token-AND search across make/model/trim/years/transmission type+code
    (`mustang gt`, `wrx 5mt`, `neon srt4`); live `N of 280 vehicles` footer, empty
    state, ↑/↓/Enter/Esc/Tab handling, ARIA combobox roles.
  - Every row shows a transmission badge (`6MT`, `7DCT`, `5AT`, `EV`) — this is what
    disambiguates the 70 model+trim twins that differ only by transmission.
  - Per-row `⚠` plus an inline warning next to the Gear select: the sharper case is a
    selected gear with no stored ratio, where `getRunProfile()` silently falls back to
    a default 3rd/4th ratio. Warning covers both "gear ratio missing" and
    "gear data incomplete (only 3rd, 4th known)".
  - Garage entries are badged `Garage`; user profiles lack make/model, so the row title
    falls back to the free-text `name`.
  - Deferred: Phase U3 (cascading Make→Model→Year→Trim browser) — not needed at this
    garage size.
  Full suite **56 passing**; `validate-cars` 0 errors.
