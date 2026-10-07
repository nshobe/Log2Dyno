# Gear Data Audit

Status: **snapshot** · Captured when the one-time Virtual Dyno import was retired.

Vehicles whose gear set is not a complete `1..N` sequence. Virtual Dyno only stored
the gears used for a dyno pull (usually 3rd and 4th), so these are the remaining
research targets.

**How to fix one:** research the transmission, then edit that vehicle's `gears` (and
`transmission`) directly in `server/data/cars/<make>.json`, set `gearDataComplete`
to `true`, and run:

```bash
npm run validate-cars
```

The `VD source` column below is a stable identifier for the original Virtual Dyno
entry (also stored on each car as `source.file` / `source.index`).

## Summary

| Metric | Count |
|---|---|
| Catalog entries | 278 |
| Complete gear sets | 248 |
| Incomplete gear sets | 30 |
| Backfilled from presets | 205 |
| Ambiguous preset matches | 0 |
| Virtual Dyno "custom" entries | 2 |
| Curated (non-VD) entries | 1 |

### Backfill coverage by preset

| Preset | Cars completed |
|---|---|
| `zf-6hp19-6r80` | 17 |
| `bmw-gs6-53bz` | 10 |
| `bmw-dct-7dci600` | 8 |
| `subaru-5mt-3.166` | 8 |
| `tremec-t56-close` | 7 |
| `tremec-t56-base` | 7 |
| `gm-4l60e` | 7 |
| `mitsubishi-dsm-awd-5mt` | 6 |
| `honda-civic-si-6mt-k20z3` | 6 |
| `subaru-5mt-3.454` | 6 |
| `ford-tr3650` | 5 |
| `ford-tr6060-gt500` | 5 |
| `mitsubishi-evo-5mt` | 5 |
| `bmw-gs6-f8x` | 4 |
| `bmw-dct-f8x` | 4 |
| `gm-6l80` | 4 |
| `gm-f35-5mt` | 4 |
| `toyota-86-6mt` | 4 |
| `toyota-86-6at` | 4 |
| `subaru-5eat` | 4 |
| `subaru-6mt-sti-late` | 4 |
| `bmw-gs6-45bz` | 3 |
| `tremec-tr6060-challenger` | 3 |
| `dodge-nag1-5at` | 3 |
| `mitsubishi-dsm-awd-4at` | 3 |
| `ford-5r55s` | 3 |
| `gm-4t65e` | 3 |
| `subaru-4eat` | 3 |
| `ford-t56-cobra` | 2 |
| `ford-mt82-coyote` | 2 |
| `ford-mt82-v6` | 2 |
| `honda-s2000-6mt` | 2 |
| `nissan-rs5f32a-g20-5mt` | 2 |
| `mazda-miata-5mt-na` | 2 |
| `mitsubishi-f5m42-5mt` | 2 |
| `mitsubishi-evo9-5mt` | 2 |
| `mitsubishi-evo-mr-6mt` | 2 |
| `mitsubishi-sst-dct` | 2 |
| `mitsubishi-galant-vr4-5mt` | 2 |
| `nissan-5mt-sr20de` | 2 |
| `nissan-5mt-ka24de` | 2 |
| `nissan-5mt-fs5r30a` | 2 |
| `toyota-v160-6mt` | 2 |
| `honda-b18c1-gsr-5mt` | 1 |
| `honda-k20-rsx-6mt` | 1 |
| `audi-0b1-6mt` | 1 |
| `ford-tr6060-falcon` | 1 |
| `ford-ib6-6mt` | 1 |
| `ford-t45` | 1 |
| `honda-d-cable-5mt` | 1 |
| `honda-k24z7-6mt` | 1 |
| `honda-h22-prelude-5mt` | 1 |
| `hyundai-m6cf1-6mt` | 1 |
| `hyundai-6hp19-6at` | 1 |
| `nissan-fs6r31a-6mt` | 1 |
| `mazda-miata-6mt-nd` | 1 |
| `mazda-sj6a-6at` | 1 |
| `mazda-miata-5mt-nb` | 1 |
| `mazda-miata-6mt-nb` | 1 |
| `mazda-fs-5mt` | 1 |
| `mazda-rx7-fd-5mt` | 1 |
| `mazda-rx8-6mt` | 1 |
| `mini-getrag-252-5mt` | 1 |
| `mitsubishi-evo-x-5mt` | 1 |
| `gm-ar5-5mt` | 1 |
| `subaru-6mt-sti-early` | 1 |
| `zf-8hp51` | 1 |
| `vw-02j-5mt` | 1 |

## Incomplete vehicles by make

### BMW (1)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Z4 sDrive30i | 2009-2012 | manual | 3:1.313, 4:1 | `BMW/Z4/Z4_09-12.xml#2` |

### Chevrolet (1)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Camaro LS/LT/RS | 2010-2011 | automatic | 3:1.55, 4:1.16 | `Chevrolet/Camaro/Camaro_10-11.xml#3` |

### Dodge (3)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Neon Sport | 1995-1999 | manual | 3:1.367, 4:1.03 | `Dodge/Neon/Neon_Sport_95-99.xml#0` |
| Neon SRT4 | 2003-2005 | manual | 2:2.045, 3:1.367, 4:0.947, 5:0.756 | `Dodge/Neon/Neon_SRT4_03-05.xml#0` |
| Neon SXT | 2003-2005 | manual | 3:1.367, 4:1.03 | `Dodge/Neon/Neon_SXT_03-05.xml#0` |

### Ford (3)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Focus ZX3 | 2000-2004 | manual | 3:1.448, 4:1.028 | `Ford/Focus/Focus_ZX3_00-04.xml#0` |
| Focus SES | 2008-2011 | manual | 3:1.448, 4:1.028 | `Ford/Focus/Focus_SES_08-11.xml#0` |
| Focus ST | 2013 | manual | 3:1.321, 4:1.029 | `Ford/Focus/Focus_ST_13-13.xml#0` |

### Honda (4)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| City 1.5 (Asia) | 2000-2004 | manual | 3:1.25, 4:0.9375 | `Honda/City/City_1.5Asia_00-04.xml#0` |
| Civic SiR | 2002-2005 | manual | 2:1.769, 3:1.212, 4:0.921 | `Honda/Civic/Civic_SiR_02-05.xml#0` |
| Prelude SI 4WS | 1990-1991 | manual | 2:1.809, 3:1.289, 4:0.964 | `Honda/Prelude/Prelude_4WS_90-91.xml#0` |
| Prelude VTEC | 1993-1996 | manual | 3:1.36, 4:1.071 | `Honda/Prelude/Prelude_93-96.xml#0` |

### Hyundai (1)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Genesis Coupe 2.0T | 2009-2012 | automatic | 3:1.52, 4:1 | `Hyundai/Genesis/Genesis_Coupe_09-12.xml#1` |

### Infiniti (2)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| G20 Base | 2000-2002 | manual | 3:1.286, 4:0.926 | `Infiniti/G20/G20_00-02.xml#0` |
| G20 Touring/Sport | 2000-2002 | manual | 3:1.286, 4:0.926 | `Infiniti/G20/G20_00-02.xml#1` |

### Mazda (2)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| RX-7 | 1993-1995 | automatic | 2:1.619, 3:1 | `Mazda/RX-7/RX7_93-95.xml#1` |
| Speed3 | 2010-2013 | manual | 3:1.37, 4:1.03 | `Mazda/Speed3/Speed3_10-13.xml#0` |

### Mitsubishi (5)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Eclipse GT | 2000-2005 | manual | 3:1.407, 4:1.031 | `Mitsubishi/Eclipse/Eclipse_GT_00-05.xml#0` |
| Evolution 3 GSR | 1995-1996 | manual | 3:1.16, 4:0.862 | `Mitsubishi/Evo/Evo_III.xml#0` |
| Evolution 6.5 TME | 1999-2001 | manual | 3:1.444, 4:1.096 | `Mitsubishi/Evo/Evo_VI_5.xml#0` |
| Lancer | 2009-2010 | automatic | 3:1.074, 4:0.832 | `Mitsubishi/Lancer/Lancer_09-10.xml#0` |
| Lancer | 2009-2010 | manual | 3:1.333, 4:1.028 | `Mitsubishi/Lancer/Lancer_09-10.xml#1` |

### Volkswagen (6)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| Golf TDI | 2010 | manual | 3:1.26, 4:0.87 | `Volkswagen/Golf/Golf_TDI_10.xml#0` |
| Golf R Euro DSG (4 Door) | 2012-2013 | manual | 3:1.4, 4:1.032 | `Volkswagen/Golf/Golf_R_12-13.xml#0` |
| Golf MK7 (2door) | 2015-2017 | automatic | 3:1.14, 4:0.78 | `Volkswagen/Golf/Golf_MK7_15-17.xml#3` |
| Golf MK7 (2Door) | 2015-2017 | manual | 3:1.46, 4:1.08 | `Volkswagen/Golf/Golf_MK7_15-17.xml#1` |
| Golf MK7 (4door) | 2015-2017 | automatic | 3:1.14, 4:0.78 | `Volkswagen/Golf/Golf_MK7_15-17.xml#2` |
| Golf MK7 (4door) | 2015-2017 | manual | 3:1.46, 4:1.08 | `Volkswagen/Golf/Golf_MK7_15-17.xml#0` |

### Volvo (2)

| Vehicle | Years | Trans | Known gears | VD source |
|---|---|---|---|---|
| S60 R | 2004-2005 | automatic | 3:1.98, 4:1.34 | `Volvo/S60/S60_R_04-05.xml#0` |
| S60 R | 2004-2005 | manual | 3:1.43, 4:1.09 | `Volvo/S60/S60_R_04-05.xml#1` |

