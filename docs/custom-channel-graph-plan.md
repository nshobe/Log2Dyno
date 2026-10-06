# Custom Channel Graph — Implementation Plan

Owner: ImMrTea / nshobe
Goal: Let users pick **any channel found in a log** and plot it on the lower
telemetry graph alongside the existing Boost / Lambda / Timing / Throttle traces.

Status legend: `[ ]` todo · `[x]` done · `[~]` in progress · `[!]` blocked
## Problem

The lower graph can only draw four hard-coded channels. Everything else in the
log is parsed server-side into `allRows` (14 normalized fields) but raw channel
values never reach the browser, and `dynoMath.calculateDyno` only smooths and
interpolates those fixed fields into `curvePoints`.

## Design

Fifth trace = a `<select>` in the LOWER GRAPH group whose options are the union of
numeric channels across loaded logs. Data is fetched **on demand** (one channel at
a time) to avoid shipping hundreds of columns for wide Haltech logs.

1. **Server — channel series extraction** (`server/parser.js`)
   - `finalizeParse` accepts `options.series: string[]`; builds `series[name]`
     arrays aligned to the normalized-row order (rows skipped for bad t/rpm are
     skipped in the series too).
   - Adds `numericChannels`: channels with >= 2 numeric samples, so the UI only
     offers real data.
   - Adds `pulls[].startIndex` / `endIndex` (indices into `allRows`) so the client
     can slice a series to a pull without re-matching rows.
2. **Server — endpoint** (`server/index.js`)
   - `POST /api/channel-series` re-parses the stored log content with
     `options.series=[...requested]` and returns
     `{ series, numericChannels, totalRows, missing }`.
3. **Server — interpolation** (`server/dynoMath.js`)
   - `calculateDyno(pullData, profile, rpmStep, customName)` treats `pt.custom`
     as a generic extra channel: same Gaussian smoothing + RPM-grid interpolation
     as boost/lambda/etc. Emits `curvePoints[].custom` and returns
     `customName`, `customMin`, `customMax`.
4. **Frontend — selector + fetch** (`public/index.html`, `public/app.js`)
   - Add `#customChannelSelect` to the LOWER GRAPH group (persisted via
     `prefGet/prefSet('custom_channel')`).
   - Options = union of `log.numericChannels` from `loadedLogs`, sorted; sentinel
     empty value = off.
   - On change: lazily `POST /api/channel-series` for each run log that has the
     channel and cache on `log._series[name]`, then recalc.
   - `calcSingleRun` injects `custom` per pull row using `pull.startIndex` and
     passes `customName` to `/api/calculate-dyno`.
5. **Frontend — rendering** (`public/dynoCanvas.js`)
   - `setCustomChannel(name)`; auto-scale custom trace to `[customMin, customMax]`
     across both runs, distinct color, dashed for Run B.
   - Axis label + live cursor callout for the custom trace.

## Decisions

- **On-demand fetch, not embedded series**: keeps payload small for wide logs
  (Haltech wide samples have 800+ channels).
- **Additive only**: new response keys and endpoint; the normalized row contract
  (`t, rpm, tps, mapPsi, boostPsi, lambda, targetLambda, ignition, knock, gear,
  speedMph, vvt, oilPressurePsi, iatF`) is untouched.
- **No new npm dependencies**.

## Tasks

### Server
- [x] `parser.js`: `options.series` aligned arrays + `numericChannels`
- [x] `parser.js`: `pulls[].startIndex` / `endIndex`
- [x] `index.js`: `POST /api/channel-series`
- [x] `dynoMath.js`: generic `custom` smoothing/interpolation

### Frontend
- [x] `index.html`: `#customChannelSelect` in LOWER GRAPH group
- [x] `app.js`: option population, persistence, series cache, pull injection
- [x] `dynoCanvas.js`: custom trace, bounds, label, callouts

### Tests & docs
- [x] `tests/customChannel.test.js`: series alignment, numericChannels, pull indices
- [x] test: dynoMath custom interpolation
- [x] README feature note
- [x] `npm test` green (25 passing)
- [x] Commit + push to `nshobe/Log2Dyno`

## Progress log

- 2026-10-06: Recon done (parser, index, dynoMath, app.js, dynoCanvas.js).
  Plan written.
- 2026-10-06: Implemented server (parser series/numericChannels/pull indices,
  `/api/channel-series`, dynoMath `custom`) and frontend (selector, lazy fetch,
  pull injection, canvas trace/legend/callouts, CSS). 25 tests pass. Verified in
  headless Chromium: options populate (22 channels), trace renders, pref persists
  across reload and re-applies on re-upload, no JS errors.
