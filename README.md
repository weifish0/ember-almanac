# Ember Almanac

**One fire record from two satellites.** NASA MODIS and VIIRS hot spots, harmonized into a burning activity calendar for any place on Earth, 2000–2025.

- **Live app:** https://weifish0.github.io/ember-almanac/
- **30-second demo:** [demo/ember-almanac-demo.mp4](demo/ember-almanac-demo.mp4) (also at https://weifish0.github.io/ember-almanac/demo.mp4)
- **Challenge:** NASA Space Apps Challenge 2026 — *Harmonization of MODIS and VIIRS Hot Spots*

Draw a box anywhere on the map and the app answers four questions a fire manager asks about a place:

1. **When does it normally burn?** The fire season window (the shortest stretch holding 80% of a normal year's burning) and its peak date.
2. **What did each year look like?** A calendar with one row per year and one mark per day, 2000 to 2025.
3. **Which periods were unusual?** Runs of five or more days above the 90th percentile for that time of year, ranked.
4. **Is activity rising or falling?** Yearly totals with an uncertainty interval, a Theil–Sen trend and a Mann–Kendall test.

All of it rests on a single, consistent record, which is the hard part.

## The problem

Satellites have logged active fires since November 2000, but the record is split across sensors that cannot be compared directly:

| Sensor | Satellites | Pixel | In the archive |
|---|---|---|---|
| MODIS (Collection 6.1) | Terra, Aqua | 1 km | 2000 → |
| VIIRS (375 m) | Suomi NPP | 375 m | 2012 → |

VIIRS resolves several pixels where MODIS reports one, and it sees small or cool fires MODIS misses altogether. Worldwide it records **4.1× more detections** from the same fires. Splice the two raw records and every place on Earth appears to quadruple its burning in January 2012.

A single global scale factor does not fix this. The ratio runs from **2.6× to 6.3×** across the burning world (5th to 95th percentile) and it shifts through the season.

## The method

`VIIRS-equivalent(cell, day) = R[cell, month] × MODIS(cell, day)`

1. **Same rules for both sensors.** Every detection is screened identically: vegetation fires only (`type = 0`, which drops volcanoes, gas flares and other static sources) and low-confidence detections removed. Detections are counted on one 0.25° daily grid, keeping Terra, Aqua and S-NPP separate.
2. **Learn the exchange rate where the sensors overlap.** `R` is a ratio of sums, VIIRS over MODIS, per grid cell and per calendar month (pooled with the two neighbouring months), from the overlap years.
3. **Borrow strength instead of guessing.** Each level of a hierarchy — global → 5° block → 1° cell → 0.25° cell — is shrunk toward its parent with a gamma-Poisson prior worth `K` MODIS detections. Data-rich cells keep their own ratio; sparse cells lean on their neighbourhood. `K` is tuned on an inner split.
4. **Use only stable-orbit years.** Terra and Aqua began drifting from their nominal overpass times in 2022, which changes what MODIS detects. The pre-VIIRS record was flown at nominal orbits, so ratios are learned from 2012–2021 only.
5. **Two ratios.** One for Terra + Aqua, and a separate one for the Terra-only months (Nov 2000 – Jul 2002).
6. **Bridge VIIRS outages.** Days when VIIRS was not observing are excluded from the fit and filled with MODIS × ratio, so a satellite safe-mode does not show up as a quiet fortnight.
7. **Nothing is hidden.** The browser receives the *raw* daily counts of all three satellites plus each cell's twelve ratios, and applies the harmonization itself. Hover any day to see both.

From 2012 onward the calendar shows VIIRS as observed. Before 2012 it shows MODIS restated in VIIRS terms, marked as an estimate.

## Does it work?

Validation is a **backcast**, the same direction as the real task. Ratios are learned from 2015–2021; MODIS alone is then used to rebuild 2012–2014, the earliest VIIRS years, and the result is compared with what VIIRS actually recorded.

| Method | Typical error, 1° cell × month | Overall bias | Within ±25%, 5° block × year |
|---|---|---|---|
| Splice the raw counts | 77% | −75% | 0% |
| One global scale factor | 35% | +1% | 50% |
| **Ember Almanac** | **26%** | **+0.4%** | **74%** |

At the scale of a region and a year (5° block), the typical error is **10%**. Typical error is the median absolute percentage error over units with at least 20 VIIRS detections. Much of what remains at fine scales is counting noise: a 1° cell with 20 VIIRS detections in a month has about five MODIS detections to estimate from.

Applied to the drift years 2022–2025 as a stress test, the same model gives 29% typical error at 1° × month and −6% bias, which is why those years are kept out of the fit.

The yearly chart in the app carries an 80% interval on every pre-2012 bar, taken from the empirical error of the backcast at a similar magnitude.

### Limits

- A detection is a hot pixel at overpass time. It is not a fire count and not a burned area.
- Cloud and thick smoke hide fires from both sensors.
- Harmonization restores *how much* burned, not the exact day. MODIS misses small fires outright, so the pre-2012 record should be read at weekly scale or coarser.
- VIIRS itself has gaps. S-NPP returned no fire data from 27 July to 10 August 2022, for example. The pipeline detects such days (global VIIRS/MODIS ratio below 2; 55 days in all) and fills them from MODIS the same way as the pre-VIIRS era, flagged as estimates.
- The archive used here ends on 31 December 2025.

## NASA data used

| Dataset | Use |
|---|---|
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) MODIS Collection 6.1 active fire archive (MCD14ML, Terra + Aqua), 2000–2025 | 102.7 million screened detections |
| NASA FIRMS VIIRS S-NPP 375 m active fire archive (VNP14IMGT), 2012–2025 | 231.3 million screened detections, the reference sensor |
| [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) Blue Marble Shaded Relief and Bathymetry | Basemap |

Total: **333,901,564** detections. Other data: Natural Earth (borders, coastlines; public domain), OpenFreeMap / OpenStreetMap (place labels).

## How it is built

```
pipeline/                      Python + DuckDB, runs on Google Cloud Build
  download.sh                  NASA FIRMS yearly country archives (≈7 GB)
  01_aggregate.py              screen + grid to 0.25° daily, per satellite
  02_model.py                  fit ratios, backcast validation, error model
  03_tiles.py                  pack 406 binary tiles + climatology + meta.json (85 MB total)
web/                           Vite + React + TypeScript + MapLibre GL (static site, no backend)
  src/lib/data.ts              tile decoder; applies the harmonization in the browser
  src/lib/stats.ts             season window, percentiles, episodes, trend
  src/components/              map plate, calendar, charts, method panel
video/                         Remotion project for the demo video
```

The app is a static site on GitHub Pages. The data are static files in a public Google Cloud Storage bucket; the browser loads only the 10° tiles an area touches and aggregates them locally, so there is no server to run or pay for.

### Reproduce

```bash
# data pipeline (needs a Google Cloud project with Cloud Build + Cloud Storage)
gcloud builds submit --config cloudbuild.yaml .

# or locally (downloads ≈7 GB from NASA FIRMS)
uv venv .venv && uv pip install --python .venv/bin/python duckdb numpy pandas pyarrow
bash pipeline/download.sh
.venv/bin/python pipeline/01_aggregate.py
.venv/bin/python pipeline/02_model.py
.venv/bin/python pipeline/03_tiles.py

# web app
cd web && pnpm install && pnpm dev
```

## Use of AI

- Code, analysis and the demo video were written with Claude Code (Anthropic) under the team's direction.
- The video's voice-over was generated with Google Gemini TTS from the team's own script, using a team member's own voice.
- No AI-generated imagery is used. Every map, chart and number is computed from the NASA data above.

## Credits and licence

Fire data courtesy of NASA FIRMS (LANCE / EOSDIS). Imagery courtesy of NASA GIBS. We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS). This project is not endorsed by NASA.

Code: MIT licence.
