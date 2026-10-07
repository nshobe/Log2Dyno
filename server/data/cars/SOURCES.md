# Catalog Sources & Attribution

**These files are now the canonical, hand-maintained catalog.** They were bootstrapped
once from the Virtual Dyno database by a one-time importer that has since been retired
(deleted), so there is no generator to re-run — edit `server/data/cars/*.json` directly.

After any edit, validate:

```bash
npm run validate-cars    # structural checks + gear-completeness summary
npm test                 # includes catalog validation
```

Retained reference material (historical inputs to the one-time import, no longer read
by any code):

| File | Purpose |
|---|---|
| `server/data/transmissions.json` | transmission ratio lookup (69 presets) with source notes |
| `server/data/gear-overrides.json` | the 38 researched per-vehicle corrections applied during the import |
| `server/data/curated-cars.json` | hand-authored vehicles not present in Virtual Dyno |
| `docs/gear-audit.md` | snapshot of the 30 remaining incomplete gear sets |

## Virtual Dyno car database

- Source: local Virtual Dyno install (Brad Barnhill) under
  `…/AppData/Roaming/Virtual Dyno/Cars`, read only at import time.
- 277 `CarParameters` entries across 162 XML files / 25 makes (model years 1990–2020).
- Imported fields: make, model, sub-model, year range, curb weight, transmission
  type, gear ratios, final drive, drag coefficient, frontal area, tire diameter.
- Virtual Dyno only stores the gears typically used for a dyno pull (usually 3rd and
  4th), so imported entries may start with an incomplete `gears` map. See
  `docs/gear-audit.md`.

## Manufacturer / transmission specifications

Gear ratios not provided by Virtual Dyno are filled from manufacturer-published
transmission specifications. These are public vehicle specifications; the combined
catalog is a derived work maintained by Log2Dyno.

Presets applied during the one-time backfill (see `server/data/transmissions.json`
for ratios and per-preset source notes):

- Subaru 5MT / 6MT STi
- Mitsubishi DSM AWD 5MT/4AT, Evo 5MT
- Toyota/Aisin 86/BRZ/FR-S 6MT/6AT, ZF 8HP51
- Honda S2000 6MT, Civic Si 6MT (K20Z3)
- Ford TREMEC T45 / TR-3650, Getrag MT-82
- TREMEC T56 (wide + close), TR-6060 (Challenger)
- GM 4L60E, 6L80E, F35 5MT
- BMW ZF GS6-53BZ, Getrag 7DCI600 M-DCT, ZF 6HP19 / Ford 6R80
- Mercedes 722.6 / NAG1 5AT (Challenger)
- Nissan 5MT (FS5R30A, KA24DE, SR20DE)
- Mazda Miata NA/NB 5MT/6MT, RX-8 6MT

## Per-vehicle overrides (research pass 2)

`server/data/gear-overrides.json` records the 38 per-vehicle corrections that were
applied **after** preset backfill, so they always won. The ratios are now baked into
the catalog; the file is retained as provenance. Each entry records the transmission
code and a source note. Sources used for the conflict-resolution pass (researched
specs preferred over conflicting Virtual Dyno values):

- **GM** — DieselHub (4L60E `3.059/1.625/1.000/0.696`, 4L80E `2.482/1.482/1.000/0.750`),
  GMtuners transmission tables, Wikipedia (Getrag F23 M86 `3.58/2.02/1.35/0.98/0.69`,
  Aisin AY6 MV5 `4.48/2.58/1.63/1.19/1.00/0.75`).
- **Mitsubishi** — 3000GT/Stealth Wiki (W5MG1, W6MG1, F5M33), GearBoxList (F5A51 5AT),
  Mitsubishi/JDM FSM extracts.
- **BMW / Mini** — Grokipedia ZF S6-37 (GS6-37BZ `4.35/2.496/1.665/1.234/1.000/0.851`,
  GS6-37DZ diesel), BMW Group press technical data, Mini technical data (Getrag 285).
- **Audi** — Audi UK / Audi USA technical data (TT RS 6MT), Audi 01E service data,
  DL501 (0B5) S tronic specs.
- **Mazda** — Mazda USA technical spec sheets (Mazda6 V6 5MT, CX-7 5AT/6AT,
  Mazdaspeed3/Speed6 6MT).
- **Honda** — Honda News / Honda service data (Honda 6MT/5MT ratio tables).
- **Subaru** — NASIOC / LegacyGT transmission tables (5MT, 6MT spec.B).
- **Nissan / Infiniti** — RE5R05A 5AT specs.
- **Pontiac / Saab** — TREMEC TR-6060, Aisin AF40-6 (TF-80SC) specs.
- **Ford** — Getrag MT-82 ratio tables.

## Notes

- `data/cars.json` (the user "garage") is **not** part of the catalog and is never
  read or written by the catalog tooling.
- `docs/gear-audit.md` is a snapshot listing every vehicle still missing a complete
  gear set — the remaining research worklist.
