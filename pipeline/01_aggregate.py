"""Step 1 - Aggregate raw NASA FIRMS active-fire detections onto a common 0.25 degree daily grid.

Input : data/raw/{modis,viirs-snpp}_{year}_all_countries.zip   (NASA FIRMS country archives)
Output: data/work/agg/{sensor}_{year}.parquet with columns
        cell (int32, iy*1440+ix), date, sat ('T' Terra, 'A' Aqua, 'N' S-NPP), n (detections), frp (MW, summed)

Quality screening applied identically to both sensors so the records are comparable:
  * type == 0 only  -> "presumed vegetation fire" (drops volcanoes, static industrial sources, offshore flares)
  * low-confidence detections removed (MODIS confidence < 30, VIIRS confidence == 'l')
"""
import pathlib
import shutil
import sys
import zipfile

import duckdb

ROOT = pathlib.Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
AGG = WORK / "agg"
AGG.mkdir(parents=True, exist_ok=True)

RES = 0.25
NX = int(360 / RES)
NY = int(180 / RES)


def aggregate(zip_path: pathlib.Path) -> None:
    sensor, year = zip_path.name.split("_")[:2]
    out = AGG / f"{sensor}_{year}.parquet"
    if out.exists():
        return
    tmp = WORK / f"tmp_{sensor}_{year}"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(tmp)
    con = duckdb.connect()
    con.execute("SET threads TO 8")
    is_modis = sensor == "modis"
    conf = "TRY_CAST(confidence AS INTEGER) >= 30" if is_modis else "lower(CAST(confidence AS VARCHAR)) <> 'l'"
    sat = "upper(substr(CAST(satellite AS VARCHAR), 1, 1))"
    glob = str(tmp / "**" / "*.csv")
    con.execute(
        f"""
        COPY (
          SELECT
            CAST(LEAST({NY - 1}, GREATEST(0, floor((latitude + 90) / {RES}))) * {NX}
               + LEAST({NX - 1}, GREATEST(0, floor((longitude + 180) / {RES}))) AS INTEGER) AS cell,
            CAST(acq_date AS DATE) AS date,
            {sat} AS sat,
            CAST(count(*) AS INTEGER) AS n,
            CAST(sum(COALESCE(TRY_CAST(frp AS DOUBLE), 0)) AS FLOAT) AS frp
          FROM read_csv('{glob}', union_by_name = true, all_varchar = false,
                        types = {{'confidence': 'VARCHAR', 'satellite': 'VARCHAR', 'version': 'VARCHAR',
                                  'acq_time': 'VARCHAR', 'type': 'VARCHAR'}})
          WHERE COALESCE(TRY_CAST(type AS INTEGER), 0) = 0 AND {conf}
          GROUP BY ALL
        ) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    pathlib.Path(f"{out}.tmp").rename(out)
    rows, dets = con.execute(f"SELECT count(*), sum(n) FROM '{out}'").fetchone()
    print(f"{sensor} {year}: {dets:,} detections -> {rows:,} cell-day rows", flush=True)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    done = sorted(p for p in RAW.glob("*.zip") if pathlib.Path(str(p) + ".done").exists())
    if len(sys.argv) > 1:
        done = [p for p in done if any(a in p.name for a in sys.argv[1:])]
    for p in done:
        aggregate(p)
