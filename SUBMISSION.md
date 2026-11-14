# Space Apps project page — text to paste

Challenge: **Harmonization of MODIS and VIIRS Hot Spots**

## Project name

Ember Almanac

## High-level summary

Satellites have recorded active fires every day since 2000, but the record is split: MODIS sees 1 km pixels, VIIRS (from 2012) sees 375 m pixels and reports about four times more detections from the same fires. Spliced together, the raw records make every place on Earth appear to quadruple its burning in 2012. Ember Almanac harmonizes 334 million NASA FIRMS detections into one consistent record and turns it into a burning activity calendar for any area a user draws. It learns a local, seasonal exchange rate between the sensors from the years both flew, restates the MODIS era in VIIRS terms with an uncertainty interval, and fills VIIRS outages the same way. For a selected area the web app shows when burning normally starts, peaks and ends, a day-by-day calendar of every year since 2000, the periods that broke the pattern, and the long-term trend. It gives responders, land managers and scientists a like-for-like view of 25 years of fire, in the browser, with no account or download.

## Link to project demo

https://weifish0.github.io/ember-almanac/demo.mp4

## Link to final project

- Live app: https://weifish0.github.io/ember-almanac/
- Source code: https://github.com/weifish0/ember-almanac

## Detailed project description

**What it does.** Ember Almanac is a web application. The map shows where the planet typically burns in each month, or which month each place burns most. The user draws a box (or opens a preset such as Northern Thailand, Punjab, the Amazon's arc of deforestation or Boreal Canada) and gets an "almanac" for that area:

- the fire season: the shortest window that holds 80% of a normal year's burning, and the normal peak date;
- a burning calendar with one row per year and one mark per day, 2000–2025;
- any year laid over the normal seasonal cycle (median, middle half and 10–90th percentile of all years);
- yearly totals with an 80% interval on estimated years, a Theil–Sen trend and a Mann–Kendall significance test;
- a ranked list of unusual episodes: runs of five or more days above the 90th percentile for that time of year;
- a CSV export of the daily record and a shareable link.

**How the harmonization works.**

1. Both sensors are screened by the same rules (vegetation fires only, low-confidence detections removed) and counted on one 0.25° daily grid, keeping Terra, Aqua and Suomi NPP separate.
2. For every grid cell and calendar month we estimate the ratio of VIIRS to MODIS detections from the overlap years. The ratio is not a constant: it runs from 2.6× to 6.3× across the burning world.
3. A hierarchy (global → 5° block → 1° cell → 0.25° cell) shrinks each ratio toward its parent with a gamma-Poisson prior, so busy cells keep their own ratio and sparse cells borrow from their neighbourhood.
4. Ratios are learned only from 2012–2021, before Terra and Aqua began drifting from their nominal orbits.
5. Before 2012 the record is MODIS × ratio (a separate ratio for the Terra-only months of 2000–02). From 2012 it is VIIRS as observed. Days when VIIRS was not observing (55 in all; the longest run is 27 July – 10 August 2022) are detected automatically and filled from MODIS.
6. The browser receives the raw counts of all three satellites plus the ratios and applies the harmonization itself, so every number can be inspected.

**How we know it works.** We backcast: ratios learned from 2015–2021, then MODIS alone used to rebuild 2012–2014 and compared with what VIIRS recorded. Splicing raw counts is biased by −75%. A single global factor has a typical error of 35% per 1° cell and month. Ember Almanac brings that to 26% with +0.4% bias, and to 10% at the scale of a region and a year, where 74% of estimates fall within ±25% of the truth (50% for the global factor).

**Benefits.** Fire managers can compare a current season with seasons before 2012 on the same scale. Early-warning teams get the normal start, peak and end of burning for any district. Researchers get a documented, reproducible, validated harmonized series for any box on Earth.

**Tools and technology.** Python, DuckDB and NumPy for the pipeline, run on Google Cloud Build; static binary tiles on Google Cloud Storage; a static web app in TypeScript, React, Vite and MapLibre GL on GitHub Pages; Remotion for the demo video. There is no backend: the browser loads only the tiles an area touches and computes the statistics locally.

**Limits we state in the app.** A detection is a hot pixel at overpass time, not a fire or a burned area. Cloud and smoke hide fires. Harmonization restores how much burned, not the exact day, so the pre-2012 record should be read at weekly scale or coarser. The archive used ends on 31 December 2025.

## NASA data

- **NASA FIRMS MODIS Collection 6.1 active fire archive** (Terra and Aqua, 1 km), November 2000 – December 2025: 102.7 million screened detections. Latitude, longitude, date, satellite, confidence and type of every detection are used.
- **NASA FIRMS VIIRS S-NPP 375 m active fire archive**, January 2012 – December 2025: 231.3 million screened detections. This is the reference sensor that the MODIS era is restated in.
- **NASA GIBS Blue Marble Shaded Relief and Bathymetry**: the basemap.

The FIRMS data are the core of the project: the harmonization model, its validation, the map layers and every chart are computed from them.

## Space agency partner and other data

- Natural Earth (public domain): country borders and coastlines.
- OpenFreeMap / OpenStreetMap contributors (ODbL): place labels.

## References

- NASA FIRMS, Fire Information for Resource Management System: https://firms.modaps.eosdis.nasa.gov/
- NASA FIRMS country archive downloads: https://firms.modaps.eosdis.nasa.gov/country/
- Giglio, L., Schroeder, W., Justice, C. O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. *Remote Sensing of Environment*, 178, 31–41.
- Schroeder, W., Oliva, P., Giglio, L., Csiszar, I. A. (2014). The New VIIRS 375 m active fire detection data product. *Remote Sensing of Environment*, 143, 85–96.
- NASA GIBS: https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api
- Natural Earth: https://www.naturalearthdata.com/
- OpenFreeMap: https://openfreemap.org/ · OpenStreetMap: https://www.openstreetmap.org/copyright
- Open-source software: DuckDB, NumPy, pandas, React, Vite, MapLibre GL JS, Remotion, Fraunces and Instrument Sans typefaces (SIL Open Font License).

## Use of artificial intelligence

- Claude Code (Anthropic) was used to write the pipeline, the web application and the video composition, and to help analyse results, under the team's direction and review.
- The voice-over in the demo video was generated with Google Gemini TTS from the team's own script, using a team member's own voice.
- No AI-generated images or video are used. Every map, chart and number is computed from the NASA data listed above. NASA branding is not used.
