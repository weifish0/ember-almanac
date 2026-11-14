"""Step 1 - Download the NASA FIRMS archives and grid every detection onto a common 0.25 degree daily grid.

Source : https://firms.modaps.eosdis.nasa.gov/country/  yearly "all countries" archives
           modis        MODIS Collection 6.1, Terra + Aqua, 1 km      2000 ->
           viirs-snpp   VIIRS 375 m on Suomi NPP                      2012 ->
           viirs-jpss1  VIIRS 375 m on NOAA-20 (JPSS-1)               2018 ->
Output : data/work/agg/{sensor}_{year}.parquet     cell (iy*1440+ix), date, sat, n (detections), frp (MW)
           sat: 'T' Terra, 'A' Aqua, 'N' Suomi NPP, 'J' NOAA-20
         data/work/static/{sensor}_{year}.parquet  per cell: all detections vs vegetation-fire detections
           (recent years only; used to correct near-real-time data, which carries no fire-type label yet)

Quality screening, identical for every sensor so the records are comparable:
  * type == 0 only  -> "presumed vegetation fire" (drops volcanoes, static industrial sources, offshore flares)
  * low-confidence detections removed (MODIS confidence < 30, VIIRS confidence == 'l')

`python 01_aggregate.py --recent` instead builds the current year's files from the API windows fetched by
00_fetch_recent.py (see that script).
"""
import pathlib
import shutil
import subprocess
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor

import duckdb

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
AGG = WORK / "agg"
STATIC = WORK / "static"
NRT = WORK / "nrt"
for d in (RAW, AGG, STATIC):
    d.mkdir(parents=True, exist_ok=True)

RES = 0.25
NX = int(360 / RES)
NY = int(180 / RES)
LAST_ARCHIVE_YEAR = 2025
STATIC_FROM = 2023          # years used to learn where static (non-vegetation) heat sources sit
ARCHIVES = (
    [("modis", y) for y in range(2000, LAST_ARCHIVE_YEAR + 1)]
    + [("viirs-snpp", y) for y in range(2012, LAST_ARCHIVE_YEAR + 1)]
    + [("viirs-jpss1", y) for y in range(2018, LAST_ARCHIVE_YEAR + 1)]
)
CELL = (
    f"CAST(LEAST({NY - 1}, GREATEST(0, floor((latitude + 90) / {RES}))) * {NX}"
    f" + LEAST({NX - 1}, GREATEST(0, floor((longitude + 180) / {RES}))) AS INTEGER)"
)


def sat_expr(sensor: str) -> str:
    if sensor == "modis":
        return "upper(substr(CAST(satellite AS VARCHAR), 1, 1))"   # Terra / Aqua
    return "'J'" if sensor == "viirs-jpss1" else "'N'"


def conf_expr(sensor: str) -> str:
    return "TRY_CAST(confidence AS INTEGER) >= 30" if sensor == "modis" else "lower(CAST(confidence AS VARCHAR)) <> 'l'"


def outputs(sensor: str, year: int) -> list[pathlib.Path]:
    out = [AGG / f"{sensor}_{year}.parquet"]
    if year >= STATIC_FROM:
        out.append(STATIC / f"{sensor}_{year}.parquet")
    return out


def download(job: tuple[str, int]) -> pathlib.Path | None:
    sensor, year = job
    name = f"{sensor}_{year}_all_countries.zip"
    path = RAW / name
    for _ in range(4):
        subprocess.run(["curl", "-sSL", "--retry", "5", "--retry-delay", "5", "-C", "-", "-o", str(path),
                        f"https://firms.modaps.eosdis.nasa.gov/data/country/zips/{name}"], check=False)
        try:
            with zipfile.ZipFile(path) as z:
                if z.testzip() is None:
                    return path
        except (zipfile.BadZipFile, FileNotFoundError):
            pass
        path.unlink(missing_ok=True)
    print(f"FAILED to download {name}", flush=True)
    return None


def aggregate(sensor: str, year: int, zip_path: pathlib.Path) -> None:
    tmp = WORK / f"tmp_{sensor}_{year}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(tmp)
    con = duckdb.connect()
    src = (
        f"read_csv('{tmp}/**/*.csv', union_by_name = true, all_varchar = false, types = {{'confidence': 'VARCHAR', "
        f"'satellite': 'VARCHAR', 'version': 'VARCHAR', 'acq_time': 'VARCHAR', 'type': 'VARCHAR'}})"
    )
    veg = "COALESCE(TRY_CAST(type AS INTEGER), 0) = 0"
    out = AGG / f"{sensor}_{year}.parquet"
    con.execute(
        f"""
        COPY (
          SELECT {CELL} AS cell, CAST(acq_date AS DATE) AS date, {sat_expr(sensor)} AS sat,
                 CAST(count(*) AS INTEGER) AS n, CAST(sum(COALESCE(TRY_CAST(frp AS DOUBLE), 0)) AS FLOAT) AS frp
          FROM {src} WHERE {veg} AND {conf_expr(sensor)} GROUP BY ALL
        ) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    pathlib.Path(f"{out}.tmp").rename(out)
    if year >= STATIC_FROM:
        con.execute(
            f"""
            COPY (
              SELECT {CELL} AS cell, CAST(count(*) AS INTEGER) AS n_all,
                     CAST(sum(CASE WHEN {veg} THEN 1 ELSE 0 END) AS INTEGER) AS n_veg
              FROM {src} WHERE {conf_expr(sensor)} GROUP BY ALL
            ) TO '{STATIC / f"{sensor}_{year}.parquet"}' (FORMAT parquet, COMPRESSION zstd)
            """
        )
    rows, dets = con.execute(f"SELECT count(*), sum(n) FROM '{out}'").fetchone()
    print(f"{sensor} {year}: {dets:,} detections -> {rows:,} cell-day rows", flush=True)
    shutil.rmtree(tmp, ignore_errors=True)
    zip_path.unlink(missing_ok=True)


def build_recent() -> None:
    """Current year from the API windows. Near-real-time rows have no fire type, so each cell's count is scaled by
    the share of vegetation fires that cell showed in recent classified years (1 where the cell has no history)."""
    if not NRT.exists() or not list(NRT.glob("*.parquet")):
        print("no API windows found - skipping the current year", flush=True)
        return
    con = duckdb.connect()
    year = LAST_ARCHIVE_YEAR + 1
    for sensor, sats in (("modis", "('T', 'A')"), ("viirs-snpp", "('N')"), ("viirs-jpss1", "('J')")):
        share = (
            f"(SELECT cell, sum(n_veg) / sum(n_all) AS share FROM read_parquet('{STATIC}/{sensor}_*.parquet') GROUP BY cell)"
        )
        out = AGG / f"{sensor}_{year}.parquet"
        con.execute(
            f"""
            COPY (
              SELECT w.cell, w.date, w.sat,
                     CAST(round(sum(CASE WHEN w.typed THEN w.n ELSE w.n * COALESCE(s.share, 1) END)) AS INTEGER) AS n,
                     CAST(sum(CASE WHEN w.typed THEN w.frp ELSE w.frp * COALESCE(s.share, 1) END) AS FLOAT) AS frp
              FROM read_parquet('{NRT}/*.parquet') w LEFT JOIN {share} s USING (cell)
              WHERE w.sat IN {sats} AND year(w.date) = {year}
              GROUP BY ALL HAVING round(sum(CASE WHEN w.typed THEN w.n ELSE w.n * COALESCE(s.share, 1) END)) > 0
            ) TO '{out}' (FORMAT parquet, COMPRESSION zstd)
            """
        )
        r = con.execute(f"SELECT count(*), sum(n), min(date), max(date) FROM '{out}'").fetchone()
        print(f"{sensor} {year} (API): {r[1] or 0:,} detections, {r[0]:,} rows, {r[2]} .. {r[3]}", flush=True)
    kept = con.execute(
        f"""SELECT sum(n), sum(n * COALESCE(s.share, 1)) FROM read_parquet('{NRT}/*.parquet') w
            LEFT JOIN (SELECT cell, sum(n_veg) / sum(n_all) AS share FROM read_parquet('{STATIC}/*.parquet') GROUP BY cell) s
            USING (cell) WHERE NOT w.typed"""
    ).fetchone()
    if kept[0]:
        print(f"near-real-time rows: {kept[1] / kept[0]:.1%} of detections kept after the static-source correction", flush=True)


if __name__ == "__main__":
    if "--recent" in sys.argv:
        build_recent()
        sys.exit(0)
    jobs = [j for j in ARCHIVES if not all(p.exists() for p in outputs(*j))]
    print(f"{len(jobs)} archives to process", flush=True)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for job, path in zip(jobs, pool.map(download, jobs)):
            if path is not None:
                aggregate(*job, path)
