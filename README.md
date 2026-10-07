# ⚡ Log2Dyno

**Lightweight Virtual Dyno & Telemetry Analysis Tool for Haltech, MegaSquirt & Generic ECU Datalogs**

![Log2Dyno Fullscreen Interface](Full_Screen.png)

Log2Dyno is a zero-friction, web-based virtual dyno and telemetry comparison tool. It parses raw exported datalogs directly—no manual log trimming, no Excel editing, and no intermediate software required. Instead of hardcoding a single ECU's column names, it detects the log format, resolves channels semantically, and normalizes units, so the same tool works across platforms.

---

## 📷 Screenshots

### Full-Screen Interactive Dyno & Telemetry Analysis
![Log2Dyno Interface](Full_Screen.png)

### High-Resolution Exported Dyno Sheet
![Log2Dyno Exported Sheet](screenshot_output.png)

---

## 📥 Supported Log Formats

| Format | Extensions | Notes |
|---|---|---|
| Haltech NSP raw | `.txt`, `.csv` | `%DataLog%` exports with `Channel :` declarations |
| Haltech flat CSV | `.csv` | Header + optional units row |
| TunerStudio / MS3 | `.csv`, `.msl` | Comma or tab-delimited; optional units row and `MSn Format` preamble |
| MS1 / MegaTune legacy | `.csv` | `secL` time, `Spark`, `MAT`, `CLT`, etc. |
| TunerStudio / MegaLogViewer binary | `.mlg` | MLVLG v1/v2 decoded natively (no conversion needed) |
| Generic CSV | `.csv`, `.tsv`, `.txt`, `.log` | Any delimited log with recognizable column names |

Native SD-card `.MS3` logs are a firmware-defined binary stream that is **not** decoded directly—open/convert them in TunerStudio and export as CSV or MSL. (TunerStudio binary `.mlg` files *are* supported natively.)

**Detection tips:**
- Use the **Log** selector to force a parser if auto-detect guesses wrong.
- Use the **WOT** input to change the throttle threshold for pull detection.
- Open **Channel Mapping** in the diagnostics bar to reassign any field (e.g. if your MAP column is named unusually).
- If TPS looks like 0-5V or ADC counts, the app suggests a scale factor.

---

## 🏎️ Why Log2Dyno?

If you tune or analyze ECU logs, the traditional virtual dyno workflow is tedious:
1. Open raw log in MegaLogViewer
2. Extract the pull data
3. Open CSV in Excel to delete top header metadata lines
4. Save and load into legacy Virtual Dyno software

**Log2Dyno eliminates all of that.** Just drag and drop your raw, unedited log (designed for logs with 85%+ TPS) directly into your browser.

---

## ✨ Key Features

- **Multi-Format Log Parser**: Drag & drop raw **Haltech** (NSP raw / flat CSV), **MegaSquirt / TunerStudio** (`.csv`, tab-delimited `.msl`, binary `.mlg`), **MS1 legacy**, or **generic CSV** logs. Format, delimiter, header, and units are auto-detected; channel names are mapped semantically with unit-aware conversion. A diagnostics bar shows what was detected, and a Channel Mapping panel lets you correct any field.
- **Side-by-Side Pull Comparison**: Compare two pulls (Run A vs Run B) with live power deltas (`+15.2 WHP`, `+12.8 lb-ft`), curve overlays, and synchronized telemetry.
- **Per-Run RPM Trim**: Each run has its own RPM window sliders to cut noise at the start or end of a pull; the curve, axis, and peak stats follow the trimmed window, and the window is clamped to keep enough samples for a valid calculation.
- **Live Hover Callouts**: Move your cursor across the graph to inspect instant inline readout badges for HP, torque, boost, lambda, ignition timing, and throttle position.
- **Custom Channel Graphing**: Beyond the Boost / Lambda / Timing / Throttle toggles, pick **any numeric channel found in the log** from a dropdown and overlay it on the telemetry graph, auto-scaled to its own range.
- **Independent Telemetry Smoothing**: The lower graph has its own smoothing slider (**0 = raw / unsmoothed**, 1–10 light→heavy), so boost / lambda / timing / throttle / custom traces can stay crisp while the horsepower & torque calculation keeps its own (usually heavier) smoothing.
- **Built-In Vehicle Catalog**: Ships with a read-only catalog of vehicle profiles (curb weight, occupant weight, full gear ratios, tire diameter, final drive ratio, drag coefficient, frontal area). Your own custom vehicles are kept separately in a user "garage", so app upgrades never overwrite them.
- **High-Res Export**: One-click **Print Screen** button generates clean, high-resolution PNG dyno sheets with vehicle parameters and peak stats.
- **Flexible Access**: Run it locally on your tuning laptop or host it on a home server (TrueNAS, Unraid, Docker) to access it from any browser on your network.

---

## 🚀 Quick Start Guide

### Option 1: Docker & Docker Compose (Self-Hosted / Home Server)

Ideal for TrueNAS, Unraid, Synology, or any Docker host:

```yaml
services:
  log2dyno:
    build: .
    container_name: log2dyno
    restart: unless-stopped
    ports:
      - "3300:3300"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=3300
```

**Run with Docker Compose:**
```bash
docker compose up -d
```
Access the web app in your browser at `http://<your-server-ip>:3300`.

---

### Option 2: Local Run (Windows / Mac / Linux)

Ideal for standalone tuning laptops:

1. **Prerequisites**: Install [Node.js](https://nodejs.org/) (v18 or newer).
2. **Download / Clone** this repository.
3. **Start the app**:
   - **Windows**: Double-click `start.bat`
   - **Terminal (Mac / Linux / Windows)**: Run `npm start`
4. Open your browser to `http://localhost:3300`.

---

## 🛠️ How to Use

1. Export your log from your ECU software (Haltech NSP, TunerStudio/MegaLogViewer, etc.) as `.csv` or `.msl`.
2. Drag and drop the file anywhere onto the Log2Dyno webpage (or click **📂 Drop / Open Log**).
3. Check the diagnostics bar for the detected format and mapped channels; adjust **Log** type, **WOT** threshold, or **Channel Mapping** if needed.
4. Select your vehicle profile and transmission gear.
5. Move your mouse across the graph to inspect live horsepower, torque, boost, and AFR callouts!

---

## ⚖️ Disclaimer

*Log2Dyno is an independent open-source community tool created for telemetry analysis and is not affiliated with, sponsored by, or endorsed by Haltech, EFI Analytics (TunerStudio/MegaLogViewer), or any ECU manufacturer.*
