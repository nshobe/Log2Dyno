# Multi-Format Log Support Plan (MegaSquirt + Generic)

Status: **PLANNED — not yet implemented**
Owner: Log2Dyno
Goal: Make Log2Dyno accept logs beyond Haltech (specifically MegaSquirt families) via
format detection + semantic field/unit detection, without changing the dyno math or
frontend data contract.

> This document is written to be self-sufficient if work is stopped mid-stream.
> Each phase has a checklist. Update checkboxes and the "Progress log" as work lands.

---

## 1. Why

Today `server/parser.js` is a single `parseLog()` with three hardcoded branches, all
aware of only Haltech naming conventions and comma delimiters. The app already parses
MegaSquirt logs that users manually convert to CSV, so the math and normalized row
shape are compatible. The gap is purely **input detection, delimiter handling, field
mapping, and unit interpretation**.

The entire downstream stack (`server/dynoMath.js` and `public/app.js`) consumes a fixed
normalized row shape. If we preserve that contract, all work is in the parser.

### Required normalized row contract (must not change)

```
{ t, rpm, tps, mapPsi, boostPsi, lambda, targetLambda, ignition,
  knock, gear, speedMph, vvt, oilPressurePsi, iatF }
```

`calculateDyno(pullData, carProfile, rpmStep)` and the frontend depend on these keys.

---

## 2. Current-code findings (baseline)

| Area | Location | Issue |
|---|---|---|
| Format branch | `parser.js:parseLog` | Only `%DataLog%`, Haltech flat CSV w/ units, generic CSV |
| Delimiter | `parser.js:parseStandardRows` | Hardcoded `split(',')` — MSL/TunerStudio logs are often tab-delimited |
| Preamble | `parser.js` | No handling of `"MS3 Format ..."` / metadata preamble |
| Units row | `parser.js:parseLog` | `hasUnitsRow` regex only knows Haltech-ish tokens |
| Channel map | `parser.js:identifyChannels` | Ordered regexes tuned to Haltech names |
| Unit normalization | `parser.js` | Value-magnitude guessing (`lambda > 5`, `map > 80`, `speed > 115`) |
| Time | `parser.js:parseStandardRows` | `>10000` heuristic to divide ms by 1000 |
| API | `server/index.js` | No format/options in request; rich metadata discarded |
| Frontend | `public/app.js` | Only `.csv`; never surfaces `format`/`mapping`/warnings |
| Tests | — | None; `package.json` has no test script |

Baseline: the original Haltech log was a wide flat CSV with a header and **no units
row** (time in seconds). The regression is now pinned by the committed synthetic
`tests/fixtures/haltech_wide.csv`, which reproduces the shadowing columns (see below).

---

## 3. Target formats

### Tier 1 — text (implement first)

1. Haltech NSP raw (`%DataLog%`) — existing behavior preserved.
2. Haltech flat CSV — existing behavior preserved.
3. **TunerStudio / MS3 / MS2 ASCII datalog** (`.csv`, `.msl`)
   - optional `"MS3 Format xxxx"` / `"MS2 Format ..."` preamble
   - quoted or bare header
   - optional units row
   - **comma OR tab** delimited
   - time in seconds (`Time`, `Secl`, `SecL`, `sec`)
4. **MS1 / MegaTune legacy CSV**
   - `secL` / `sec` time; `Spark`, `O2`, `TPS`, `MAP`, `RPM`, `CLT`, `MAT`
   - usually no units row
5. Generic CSV — existing fallback.

### Tier 2 — deferred (document as unsupported, not silently broken)

6. Binary `.mlg` (MLVLG v1/v2; public spec at efianalytics.com)
7. Native MS3 SD `.MS3` binary

Binary files must be detected and rejected with a clear message telling the user to
export CSV/MSL from TunerStudio.

### Merged CSV input

The user has converted MegaSquirt logs to comma CSV today; Tier 1 items 3–5 cover this.
No special "merged" branch is required, but keep an eye out for duplicate/merged header
rows in fixtures.

---

## 4. Proposed architecture

```
server/parser.js              // orchestrator: detect -> parse -> resolve -> normalize -> pulls
server/formats/index.js       // registry + detectFormat()
server/formats/haltechRaw.js  // moved existing %DataLog% logic
server/formats/delimited.js   // shared by TunerStudio / MS1 / generic
server/formats/profiles.js    // per-family synonyms + default units
server/channelMap.js          // canonical-field resolver
server/units.js               // unit canonicalization
```

Backward compatibility: keep `module.exports = { parseLog, identifyChannels, extractWotPulls }`
from `parser.js` (or re-export) so nothing importing those breaks.

---

## 5. Implementation phases

### Phase 1 — Parser core (MVP) — ✅ COMPLETE

Deliverable: TunerStudio/MS1/generic text logs parse correctly; Haltech unchanged;
tests exist. See `../server/formats/`, `../server/channelMap.js`, `../server/units.js`,
`../tests/parser.test.js`.

- [x] Create `server/formats/` and `server/units.js`, `server/channelMap.js`.
- [x] Implement `detectFormat(lines)`:
  - [x] `%DataLog%` → `haltech_nsp_raw`
  - [x] `"MSn Format"` / MegaSquirt preamble → `megasquirt_msl`
  - [x] delimiter sniff (tab vs comma vs semicolon) outside quotes across first ~5 lines
  - [x] `headerIndex` = first ~5 row that is ≥50% non-numeric
  - [x] `unitsIndex` = row after header if ≥60% cells look like units
  - [x] `dataIndex` = first row after header/units
  - [x] time column by name (`Time`, `Secl`, `SecL`, `sec`, `Seconds`); units drive ms→s
- [x] Implement `delimited.js` honoring detected `delimiter` (quote-aware split).
- [x] Implement `channelMap.js` resolver (scored, reject-awareness):
  1. exact canonical alias (case/space/underscore/unit-suffix-insensitive)
  2. family synonym
  3. regex fallback
  4. unit-confirmed semantic match
  5. else `null` — **never guess**
- [x] Implement `units.js`: kPa↔psi, °C↔°F, lambda↔AFR (only when AFR confirmed),
  mph↔km/h. Emits `unitWarnings[]`.
- [x] Remove magnitude guessing (removed `lambda > 5`, `speed > 115`, time `>10000`;
  MAP keeps a range check only as a last resort when no unit/family is known).
- [x] Refactor `parseLog` into the orchestrator; preserved output fields and added
  `formatLabel`, `family`, `detectedDelimiter`, `units`, `unmappedRequired`, `unitWarnings`.
- [x] Add `npm test` (built-in `node:test`) + fixtures + wide-Haltech regression.

Deviations / discoveries (important):
- The **pre-refactor parser mis-mapped the wide Haltech sample**: `map` resolved to the
  boolean `MAP from sensor seems valid`, `boost` to `boostStatus.pTerm`, `iat` to
  `IAT: measured resistance`, `gear` to `Gearbox Ratio`, and `tps` to `TPS2`.
  `tests/fixtures/haltech_wide.csv` deliberately contains all of these shadowing
  columns; the regression test asserts the *corrected* semantics and pull geometry.
- `normalizeName()` strips trailing unit/suffix tokens (`_kpa`, `_c`, `_pct`) so
  names like `manifold_pressure_kpa` resolve to the base concept.
- `detectFamily()` prefers Haltech markers over MegaSquirt markers to avoid
  misclassifying Haltech logs that use `CLT`/`MAT`-style short names.
- Unknown-temperature default: MegaSquirt → °F, otherwise °C, and a warning is emitted.
- `boostPsi`/`mapPsi` for the wide sample now show vacuum (~-9 psi at idle) instead of
  a flat 0/14.7 from the boolean column.

### Phase 2 — MSL polish, UI, overrides — ✅ COMPLETE

- [x] Native `.msl` tab-delimited + preamble end-to-end (parser side).
- [x] API: `/api/parse-log` accepts `options` (`format`, `delimiter`, `wotThreshold`,
  `tpsScale`, `channelOverrides`); response includes `formatLabel`, `family`,
  `detectedDelimiter`, `units`, `unitWarnings`, `unmappedRequired`, `tpsScale`,
  `tpsScaleSuggested`, `wotThreshold`.
- [x] API: `GET /api/formats` (Auto / Haltech / MegaSquirt / Generic).
- [x] Frontend accepts `.csv,.msl,.txt,.tsv,.log`; binary sniff + friendly rejection
  (null-byte detection via `ArrayBuffer` + `TextDecoder`).
- [x] Frontend "Log type: Auto / Haltech / MegaSquirt / Generic" selector (persisted).
- [x] Frontend diagnostics bar: format label, row/pull count, mapped channels, warnings;
  toggles a 14-field Channel Mapping panel.
- [x] Frontend mapping override dropdowns — re-parses the server-side log with
  `channelOverrides` and refreshes any run referencing it.
- [x] TPS scale detection/warning (0-5V/ADC heuristic) + WOT threshold override
  (`options.wotThreshold`, re-parses on change).

Verified end-to-end in headless Chromium over CDP: page loads with no JS errors, the
real `#fileInput` ingests a TunerStudio CSV, diagnostics render, Run A auto-calculates,
the mapping panel opens with 14 fields, and a forced override triggers a re-parse.

Known limitation: diagnostics/mapping reflect the most-recently ingested log, not
whichever log is selected in the Run A/B dropdowns.

### Phase 3 — Binary — ✅ COMPLETE

- [x] `.mlg` (MLVLG v1/v2) decoder in `server/formats/mlg.js`.
  - [x] Big-endian header (v1/v2 infoStart width and 55/89-byte fields)
  - [x] Scalar + bitfield field types; `(raw + transform) * scale`
  - [x] Type-0 data blocks with 16-bit 10µs timestamp + rollover handling
  - [x] Type-1 marker blocks, bit-field names, info string
  - [x] AFR channels converted to lambda via existing unit logic
- [x] `parseLogBuffer()` entry point in `server/parser.js`, sharing normalization.
- [x] API `/api/parse-log` accepts `encoding: 'base64'` for binary payloads.
- [x] Frontend detects MLG magic and uploads base64; `.ms3` (and other binary)
  rejected with a TunerStudio conversion path.
- [x] `.MS3` decoder deferred (firmware-defined, undocumented); documented
  conversion path instead.

Verified: v1 + v2 unit tests (including timestamp rollover and field scaling),
committed 1.2 KB `tests/fixtures/log2dyno_test.mlg`, API round-trip, and real browser
upload (diagnostics show "TunerStudio binary MLG", pull + dyno calculated).

---

## 6. Field mapping reference

### Canonical fields

```
time, rpm, tps, map, boost, lambda, afr, targetLambda, ignition, knock,
gear, speed, vvt, oilPressure, iat, coolant, ethanol, fuelPressure, egt, throttlePedal
```

### MegaSquirt synonym examples

| Canonical | MegaSquirt aliases |
|---|---|
| rpm | `rpm`, `engine speed` |
| map | `map`, `map1`, `mapkpa`, `manifold pressure` |
| boost | `boost`, `boostpsi`, `boostpressure` (else derive `MAP − baro`) |
| tps | `tps`, `throttle`, `throttle position`, `tpspct` |
| lambda | `lambda`, `lambda 1`, `wideband`, `o2`, `ego`, `afr`, `afr1` |
| targetLambda | `lambda target`, `target lambda`, `afr target`, `targetafr` |
| ignition | `spark`, `spark advance`, `advance`, `timing`, `ignangle` |
| knock | `knock`, `knockretard`, `knk` |
| gear | `gear` |
| speed | `vss1`, `vss`, `vehicle speed`, `speed` |
| iat | `mat`, `iat`, `manifold air temp`, `airtemp` |
| coolant | `clt`, `coolant`, `ect` |
| vvt | `vvt`, `vvt1`, `cam angle` |
| oilPressure | `oil pressure`, `oilpress`, `oilp` |
| ethanol | `ethanol`, `flex`, `eth %` |

Keep the existing Haltech aliases working via the same table (family = `haltech`).

---

## 7. Risks and decisions

- **MAP absolute vs gauge + kPa vs psi** — top correctness risk. Resolve with declared
  units, a baro channel, and 101.325 kPa fallback; surface `unitWarnings`.
- **MS1 `O2`/`EGO`** — not a real lambda reading (raw/voltage). Ignore unless a wideband
  is configured; warn.
- **TPS voltage scaling** — many MS logs are 0–5 V or ADC counts. Warn, allow override;
  do not silently scale.
- **Binary MLG/MS3** — separable effort; keep out of Phase 1 and reject clearly.
- **Regression coverage** — the committed wide-Haltech fixture locks the corrected
  channel mapping and pull geometry so the shadowing bug cannot silently return.

---

## 8. Test matrix

| Fixture | Format | Delimiter | Units row | Assertions |
|---|---|---|---|---|
| `haltech_wide.csv` | generic_csv (haltech) | comma | no | shadowing columns resolve correctly; pull geometry |
| `haltech_raw.txt` | haltech_nsp_raw | comma | n/a | channels, mapping |
| `ms3_ts.csv` | tunerstudio | comma | yes | mapping, units, pulls |
| `ms3_ts.msl` | megasquirt_msl | tab | yes | preamble skip, mapping, pulls |
| `ms1_legacy.csv` | megasquirt_ms1 | comma | no | `secL` time, `Spark`→ignition, O2 warn |
| `generic.csv` | generic_csv | comma | no | fallback mapping |

Also unit tests for: delimiter sniff, header/units detection, synonym resolver,
kPa↔psi, °C↔°F, AFR→lambda, km/h→mph.

---

## 9. Progress log

- [x] Recon: read `server/parser.js`, `server/index.js`, `public/app.js`,
  `public/index.html`, `server/dynoMath.js`; inspected sample Haltech CSV.
- [x] Research MegaSquirt/TunerStudio formats (MSL preamble, tab delimiter, field names).
- [x] Write this plan.
- [x] Phase 1 (parser core + tests) — 11 tests passing.
- [x] Phase 2 (API options + UI diagnostics/mapping) — CDP-verified in headless Chromium.
- [x] Phase 3 (binary MLG v1/v2) — 20 tests passing; UI upload verified.

### Notes / decisions made during work

- (2026-10) Capturing a pre-refactor snapshot revealed the wide Haltech log was
  mis-mapped; see Phase 1 deviations above. The original sample was untracked and has
  since been removed, so the regression is pinned by `tests/fixtures/haltech_wide.csv`.
- (2026-10) Test fixtures are synthetic and small: `ms3_tunerstudio.csv`,
  `ms3_sd.msl`, `ms1_legacy.csv`, `generic.csv`, `haltech_raw.txt`, `haltech_flat.csv`.
- (2026-10) Verified end-to-end via `/api/parse-log` + `/api/calculate-dyno`
  (peakHp/peakTq returned, `rpmStep` honored).
- (2026-10) Phase 3: MLVLG v1/v2 decoded. Note snap Chromium cannot read `/tmp`
  (confinement); browser test fixtures must live under `$HOME`.
- (2026-10) Phase 2 UI validated via headless snap Chromium over CDP
  (`DOM.setFileInputFiles` on the real `#fileInput`): no page JS errors, diagnostics
  and mapping panel work, override re-parse confirmed. `.mcp.json` was used with a
  temporary `--executablePath` and restored afterward.
