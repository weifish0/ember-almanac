"""Step 0 - Fetch the current year from the NASA FIRMS API, so the record runs to yesterday instead of stopping
at the last yearly archive.

The yearly archives (step 1) end on 31 December of last year. Everything after that comes from
https://firms.modaps.eosdis.nasa.gov/api/area/ in 5-day world windows:
  MODIS_SP / VIIRS_SNPP_SP          science quality, with the fire-type label ("typed")
  MODIS_NRT / VIIRS_SNPP_NRT        near real time, no fire-type label yet
  VIIRS_NOAA20_SP / VIIRS_NOAA20_NRT  NOAA-20, the continuity sensor for S-NPP outages and after S-NPP stopped

Needs a free MAP_KEY in the environment variable FIRMS_MAP_KEY (never commit it). The API meters use, so the
script watches the transaction counter and waits when the 10-minute allowance is nearly spent. Each window is
gridded immediately and cached as data/work/nrt/{source}_{start}.parquet; finished windows are not fetched again.
"""
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile
import time
import urllib.request

import duckdb

ROOT = pathlib.Path(__file__).resolve().parents[1]
NRT = ROOT / "data" / "work" / "nrt"
NRT.mkdir(parents=True, exist_ok=True)
KEY = os.environ.get("FIRMS_MAP_KEY", "").strip()
API = "https://firms.modaps.eosdis.nasa.gov"
YEAR_START = dt.date(2026, 1, 1)
WINDOW = 5
RES, NX, NY = 0.25, 1440, 720
# (science-quality source, near-real-time source, satellite letter or None to read it from the row, first date wanted)
SOURCES = [
    ("MODIS_SP", "MODIS_NRT", None, YEAR_START),
    ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT", "N", YEAR_START),
    ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT", "J", YEAR_START),   # the continuity sensor
]


def get(url: str, timeout: int = 600) -> str:
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def wait_for_allowance() -> None:
    while True:
        try:
            s = json.loads(get(f"{API}/mapserver/mapkey_status/?MAP_KEY={KEY}", 60))
            if s["current_transactions"] < s["transaction_limit"] * 0.8:
                return
        except Exception:
            pass
        time.sleep(45)


def fetch_window(source: str, start: dt.date, days: int, sat: str | None, typed: bool) -> None:
    out = NRT / f"{source}_{start}.parquet"
    final = start + dt.timedelta(days=days - 1) < dt.date.today() - dt.timedelta(days=10)
    if out.exists() and final:
        return
    body = ""
    for attempt in range(8):
        wait_for_allowance()
        try:
            body = get(f"{API}/api/area/csv/{KEY}/{source}/world/{days}/{start}")
        except Exception as e:  # network hiccup: back off and retry
            body = f"error: {type(e).__name__}"
        if body.startswith("latitude"):
            break
        print(f"   {source} {start}: retry {attempt + 1} ({body[:60].strip()})", flush=True)
        time.sleep(60)
    else:
        print(f"GAVE UP on {source} {start}", flush=True)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
        f.write(body)
        path = f.name
    con = duckdb.connect()
    modis = source.startswith("MODIS")
    conf = "TRY_CAST(confidence AS INTEGER) >= 30" if modis else "lower(CAST(confidence AS VARCHAR)) <> 'l'"
    sat_sql = "upper(substr(CAST(satellite AS VARCHAR), 1, 1))" if sat is None else f"'{sat}'"
    veg = "COALESCE(TRY_CAST(type AS INTEGER), 0) = 0" if typed else "true"
    con.execute(
        f"""
        COPY (
          SELECT CAST(LEAST({NY - 1}, GREATEST(0, floor((latitude + 90) / {RES}))) * {NX}
                    + LEAST({NX - 1}, GREATEST(0, floor((longitude + 180) / {RES}))) AS INTEGER) AS cell,
                 CAST(acq_date AS DATE) AS date, {sat_sql} AS sat,
                 CAST(count(*) AS INTEGER) AS n, CAST(sum(COALESCE(TRY_CAST(frp AS DOUBLE), 0)) AS FLOAT) AS frp,
                 {"true" if typed else "false"} AS typed
          FROM read_csv('{path}', all_varchar = false, types = {{'confidence': 'VARCHAR', 'satellite': 'VARCHAR',
                        'version': 'VARCHAR', 'acq_time': 'VARCHAR'{", 'type': 'VARCHAR'" if typed else ""}}})
          WHERE {veg} AND {conf} GROUP BY ALL
        ) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    pathlib.Path(f"{out}.tmp").rename(out)
    os.unlink(path)
    n = con.execute(f"SELECT COALESCE(sum(n), 0) FROM '{out}'").fetchone()[0]
    print(f"{source} {start} +{days}d: {n:,} detections", flush=True)


def main() -> None:
    if not KEY:
        print("FIRMS_MAP_KEY not set - skipping the current year")
        return
    avail = {}
    for line in get(f"{API}/api/data_availability/csv/{KEY}/all", 120).splitlines()[1:]:
        name, lo, hi = line.split(",")
        avail[name] = (dt.date.fromisoformat(lo), dt.date.fromisoformat(hi))
    print("availability:", {k: (str(v[0]), str(v[1])) for k, v in avail.items() if k.startswith(("MODIS", "VIIRS_SNPP", "VIIRS_NOAA20"))}, flush=True)
    for sp, nrt, sat, first in SOURCES:
        for source, typed in ((sp, True), (nrt, False)):
            if source is None or source not in avail:
                continue
            lo, hi = avail[source]
            day = max(lo, first) if first else lo
            while day <= hi:
                days = min(WINDOW, (hi - day).days + 1)
                fetch_window(source, day, days, sat, typed)
                day += dt.timedelta(days=days)
    print("recent windows done", flush=True)


if __name__ == "__main__":
    sys.exit(main())
