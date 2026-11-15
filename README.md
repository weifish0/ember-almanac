# Ember Almanac

**One fire record across four satellites.** NASA MODIS and VIIRS hot spots, harmonized into a burning activity calendar for any place on Earth, from November 2000 to this week.

- **Live app:** https://weifish0.github.io/ember-almanac/
- **30-second demo:** [demo/ember-almanac-demo.mp4](demo/ember-almanac-demo.mp4) (also at https://weifish0.github.io/ember-almanac/demo.mp4)
- **Challenge:** NASA Space Apps Challenge 2026 — *Harmonization of MODIS and VIIRS Hot Spots*

Draw a box anywhere on the map and the app answers four questions a fire manager asks about a place:

1. **When does it normally burn?** The fire season window (the shortest stretch holding 80% of a normal year's burning) and its peak date, or each burning period where there are several (two harvests, two pulses).
2. **What did each year look like?** A calendar with one row per year and one mark per day, from 2000 to the current week.
3. **Which periods were unusual?** Runs of five or more days above the 90th percentile for that time of year, ranked.
4. **Is activity rising or falling?** Yearly totals with an uncertainty interval, a Theil–Sen trend and a Mann–Kendall test.
5. **What is happening right now?** The last two weeks against the same two weeks in every earlier year.

All of it rests on a single, consistent record, which is the hard part.

## The problem

Satellites have logged active fires since November 2000, but the record is split across sensors that cannot be compared directly:

| Sensor | Satellites | Pixel | In the archive |
|---|---|---|---|
| MODIS (Collection 6.1) | Terra, Aqua | 1 km | 2000 → |
| VIIRS (375 m) | Suomi NPP | 375 m | 2012 → 2 Nov 2026 |
| VIIRS (375 m) | NOAA-20 | 375 m | 2018 → |

VIIRS resolves several pixels where MODIS reports one, and it sees small or cool fires MODIS misses altogether. Worldwide it records **4.1× more detections** from the same fires. Splice the two raw records and every place on Earth appears to quadruple its burning in January 2012.

And the record has just broken a second time. **Suomi NPP, the satellite behind the modern VIIRS record, delivered its last fire data on 2 November 2026.** Anything built on S-NPP alone now stops there.

A single global scale factor does not fix this. The ratio runs from **2.6× to 6.3×** across the burning world (5th to 95th percentile) and it shifts through the season.

## The method

`VIIRS-equivalent(cell, day) = R[cell, month] × MODIS(cell, day)`

1. **Same rules for both sensors.** Every detection is screened identically: vegetation fires only (`type = 0`, which drops volcanoes, gas flares and other static sources) and low-confidence detections removed. Detections are counted on one 0.25° daily grid, keeping Terra, Aqua and S-NPP separate.
2. **Learn the exchange rate where the sensors overlap.** `R` is a ratio of sums, VIIRS over MODIS, per grid cell and per calendar month (pooled with the two neighbouring months), from the overlap years.
3. **Borrow strength instead of guessing.** Each level of a hierarchy — global → 5° block → 1° cell → 0.25° cell — is shrunk toward its parent with a gamma-Poisson prior worth `K` MODIS detections. Data-rich cells keep their own ratio; sparse cells lean on their neighbourhood. `K` is tuned on an inner split.
4. **Use only stable-orbit years.** Terra and Aqua began drifting from their nominal overpass times in 2022, which changes what MODIS detects. The pre-VIIRS record was flown at nominal orbits, so ratios are learned from 2012–2021 only.
5. **Two ratios.** One for Terra + Aqua, and a separate one for the Terra-only months (Nov 2000 – Jul 2002).
6. **Carry on when the reference stops.** NOAA-20 carries the same VIIRS instrument 50 minutes away on the same orbit. Its own local ratio to S-NPP is learned from the years both flew, with the same hierarchy, and the record continues on NOAA-20 after 2 November 2026.
7. **Bridge outages.** Days when S-NPP was not observing are found automatically (the global VIIRS/MODIS ratio sits near 4 every day; below 2 means the sensor was down). They are excluded from the fits and filled from NOAA-20 where it was healthy, otherwise from MODIS × ratio, so a satellite safe-mode does not show up as a quiet fortnight.
8. **Stay current.** The yearly archives end on 31 December. The current year comes from the FIRMS API: science-quality data where it exists, near-real-time after that. Near-real-time detections carry no fire-type label yet, so each cell's count is scaled by the share of vegetation fires that cell showed in 2023–2025, which removes gas flares, industry and volcanoes the same way the archive screening does.
9. **Nothing is hidden.** The browser receives the *raw* daily counts of all three satellites plus each cell's twelve ratios, and applies the harmonization itself. Hover any day to see both.

From 2012 to 2 November 2026 the calendar shows S-NPP VIIRS as observed. Before 2012 it shows MODIS restated in VIIRS terms, and after S-NPP it shows NOAA-20 restated in S-NPP terms; both are marked.

## Does it work?

Validation is a **backcast**, the same direction as the real task. Ratios are learned from 2015–2021; MODIS alone is then used to rebuild 2012–2014, the earliest VIIRS years, and the result is compared with what VIIRS actually recorded.

| Method | Typical error, 1° cell × month | Overall bias | Within ±25%, 5° block × year |
|---|---|---|---|
| Splice the raw counts | 77% | −75% | 0% |
| One global scale factor | 35% | +1% | 50% |
| **Ember Almanac** | **26%** | **+0.4%** | **74%** |

At the scale of a region and a year (5° block), the typical error is **10%**. Typical error is the median absolute percentage error over units with at least 20 VIIRS detections. Much of what remains at fine scales is counting noise: a 1° cell with 20 VIIRS detections in a month has about five MODIS detections to estimate from.

Applied to the drift years 2022–2026 as a stress test, the same model gives 30% typical error at 1° × month and −8% bias, which is why those years are kept out of the fit and why MODIS is not used to carry the record forward.

**The hand-over to NOAA-20** is tested forward in time: fitted on 2018–2022, checked on 2023–2025 against S-NPP.

| Method | Typical error, 1° cell × month | Overall bias | Typical error, 5° block × year |
|---|---|---|---|
| NOAA-20 as is | 13% | −1.6% | 4.0% |
| **One global factor (1.018×)** | **13%** | **+0.2%** | **4.1%** |
| Local seasonal ratio | 14% | +0.7% | 4.6% |

Here the local ratio does *not* help: the two VIIRS are the same instrument design, and fitting a ratio per cell only adds noise. The pipeline keeps the simplest model the hold-out supports, so the hand-over uses the single factor.

The yearly chart in the app carries an 80% interval on every pre-2012 bar, taken from the empirical error of the backcast at a similar magnitude.

### Limits

- A detection is a hot pixel at overpass time. It is not a fire count and not a burned area.
- Cloud and thick smoke hide fires from both sensors.
- Harmonization restores *how much* burned, not the exact day. MODIS misses small fires outright, so the pre-2012 record should be read at weekly scale or coarser.
- VIIRS itself has gaps. S-NPP returned no fire data from 27 July to 10 August 2022, for example. The pipeline found 75 such days before the mission ended: 69 are filled from NOAA-20 and 6 (in 2012, before NOAA-20 flew) from MODIS, all flagged.
- November 2000 – July 2002 had only Terra. Those months are drawn in the calendar but kept out of the season statistics, the trend and the episode ranking, which start in 2003.
- The ratio is linear in MODIS detections. Very large fires add VIIRS pixels faster than MODIS pixels, so a region whose fires grew much larger after 2012 can be understated before 2012; the yearly interval is there for that reason.
- The newest weeks are near-real-time data. They are corrected for static heat sources but have not been through science-quality reprocessing, and the final day is left out because it is still filling in. The published record runs to 14 November 2026; rerunning the pipeline extends it.
- Since 2022 Terra and Aqua no longer observe at their original local times, so MODIS is not used to extend the record forward. That is NOAA-20's job.

### Sanity check: trends survive harmonization

If the method works, the change in the harmonized record between 2003–2011 and 2012–2021 should match the change MODIS alone saw over the same years, because MODIS flew through both.

| Region | Raw MODIS change | Harmonized change |
|---|---|---|
| Punjab & Haryana | +8% | +8% |
| Miombo woodlands | +2% | +2% |
| Northern Thailand | −17% | −14% |
| Taiwan | −23% | −30% |
| Northern California | +165% | +199% |

Splicing the raw records instead would report increases of roughly +200% to +1,000% for these same regions.

## NASA data used

| Dataset | Use |
|---|---|
| [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) MODIS Collection 6.1 active fires (Terra + Aqua), Nov 2000 – Nov 2026 | 105.4 million screened detections |
| NASA FIRMS VIIRS 375 m active fires, Suomi NPP, Jan 2012 – 2 Nov 2026 | 243.9 million screened detections; the reference sensor |
| NASA FIRMS VIIRS 375 m active fires, NOAA-20, Apr 2018 – Nov 2026 | 141.5 million screened detections; the continuity sensor |
| [NASA GIBS](https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api) Blue Marble Shaded Relief and Bathymetry | Basemap |

Through 2025 the detections come from the FIRMS yearly archives (science quality). 2026 comes from the FIRMS API: science quality where it exists (MODIS to 31 August, VIIRS to 31 July) and near real time after that.

Total: **490,810,661** detections. Other data: Natural Earth (borders, coastlines; public domain), OpenFreeMap / OpenStreetMap (place labels).

## How it is built

```
pipeline/                      Python + DuckDB, runs on Google Cloud Build
  00_fetch_recent.py           current year from the FIRMS API (needs a free MAP_KEY)
  01_aggregate.py              download the yearly archives (≈10 GB), screen + grid to 0.25° daily, per satellite
  02_model.py                  outage detection, ratios, backcast validation, NOAA-20 hand-over, error model
  03_tiles.py                  pack 426 binary tiles + climatology + meta.json (92 MB total)
web/                           Vite + React + TypeScript + MapLibre GL (static site, no backend)
  src/lib/data.ts              tile decoder; applies the harmonization in the browser
  src/lib/stats.ts             season window, percentiles, episodes, trend
  src/components/              map plate, calendar, charts, method panel
video/                         Remotion project for the demo video
```

The app is a static site on GitHub Pages. The data are static files in a public Google Cloud Storage bucket; the browser loads only the 10° tiles an area touches and aggregates them locally, so there is no server to run or pay for.

### Reproduce

```bash
# data pipeline on Google Cloud Build (needs Cloud Build + a Cloud Storage bucket; edit _BUCKET in cloudbuild.yaml)
gcloud builds submit --config cloudbuild.yaml --substitutions=_MAP_KEY=<your FIRMS MAP_KEY> .

# or locally (downloads ≈10 GB from NASA FIRMS)
uv venv .venv && uv pip install --python .venv/bin/python duckdb numpy pandas pyarrow
FIRMS_MAP_KEY=<your key> .venv/bin/python pipeline/00_fetch_recent.py   # optional: adds the current year
.venv/bin/python pipeline/01_aggregate.py
.venv/bin/python pipeline/01_aggregate.py --recent
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
