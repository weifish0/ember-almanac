"""Step 3 - Pack the gridded daily record + harmonization ratios into small static files for the browser.

Outputs (web/public/data):
  tiles/{tx}_{ty}.bin.gz  one per 10 x 10 degree block that ever burned. Holds, for every 0.25 degree cell,
                          the *raw* daily detection counts of Terra, Aqua and S-NPP plus that cell's 12 monthly
                          ratios. The browser applies the harmonization itself, so nothing is hidden.
  clim.bin.gz             harmonized monthly climatology for the whole planet + each cell's mean exchange rate
                          (the map layers)
  meta.json               grid definition, sensor eras, VIIRS outage days, tile index, validation report

Tile layout (little endian, before gzip):
  u32 magic 'EMB2' | u16 nCells | u16 0
  nCells x { u16 cellInTile (row*40+col, row 0 = south) | u16 0 | u32 nRecords
             | u16[12] R_TA*100 | u16[12] R_T*100 | u16[12] R_J*100 }
  u32 lenDay | u32 lenTerra | u32 lenAqua | u32 lenSnpp | u32 lenNoaa20
  five LEB128 varint streams: day (delta within a cell, first value absolute days since 2000-01-01),
  terra, aqua, snpp, noaa20. NOAA-20 counts are stored only for the days it stands in for S-NPP.
"""
import calendar
import datetime as dt
import gzip
import json
import pathlib
import shutil
import struct

import duckdb
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "data" / "work"
AGG = WORK / "agg"
OUT = ROOT / "web" / "public" / "data"
NX, NY, TILE = 1440, 720, 40
EPOCH = dt.date(2000, 1, 1)
AQUA_START, VIIRS_START = dt.date(2002, 7, 4), dt.date(2012, 1, 20)


def varint(v: np.ndarray) -> bytes:
    v = v.astype(np.uint32)
    nb = 1 + (v >= 1 << 7).astype(np.int64) + (v >= 1 << 14) + (v >= 1 << 21) + (v >= 1 << 28)
    start = np.concatenate(([0], np.cumsum(nb)[:-1]))
    out = np.zeros(int(nb.sum()), dtype=np.uint8)
    for i in range(5):
        sel = nb > i
        if not sel.any():
            break
        byte = (v[sel] >> np.uint32(7 * i)) & np.uint32(0x7F)
        out[start[sel] + i] = byte | ((nb[sel] > i + 1).astype(np.uint32) << np.uint32(7))
    return out.tobytes()


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    (OUT / "tiles").mkdir(parents=True)
    report = json.loads((WORK / "validation.json").read_text())
    ratios = np.load(WORK / "ratios.npz")
    R_TA, R_T, R_J = ratios["R_TA"], ratios["R_T"], ratios["R_J"]
    last_date = dt.date.fromisoformat(report["last_date"])
    n20_days = [(dt.date.fromisoformat(d) - EPOCH).days for d in report.get("noaa20_days", [])]
    n20_sql = ", ".join(str(d) for d in n20_days) or "-1"

    con = duckdb.connect()
    con.execute("SET threads TO 24")
    con.execute("SET memory_limit = '20GB'")
    cell, day, t, a, v, j = con.execute(
        f"""
        SELECT * FROM (
          SELECT cell,
                 CAST(date_diff('day', DATE '{EPOCH}', date) AS USMALLINT) AS day,
                 CAST(LEAST(65535, sum(CASE WHEN sat = 'T' THEN n ELSE 0 END)) AS USMALLINT) AS t,
                 CAST(LEAST(65535, sum(CASE WHEN sat = 'A' THEN n ELSE 0 END)) AS USMALLINT) AS a,
                 CAST(LEAST(65535, sum(CASE WHEN sat = 'N' THEN n ELSE 0 END)) AS USMALLINT) AS v,
                 CAST(LEAST(65535, sum(CASE WHEN sat = 'J' AND date_diff('day', DATE '{EPOCH}', date) IN ({n20_sql})
                                            THEN n ELSE 0 END)) AS USMALLINT) AS j
          FROM read_parquet('{AGG}/*.parquet')
          WHERE date <= DATE '{last_date}'
          GROUP BY cell, date)
        WHERE t + a + v + j > 0
        ORDER BY (cell // {NX} // {TILE}) * 36 + (cell % {NX}) // {TILE}, cell, day
        """
    ).fetchnumpy().values()
    print(f"cell-day records: {len(cell):,}")
    iy, ix = cell // NX, cell % NX
    tile = (iy // TILE) * 36 + ix // TILE
    tb = np.flatnonzero(np.diff(tile)) + 1
    t_starts, t_ends = np.concatenate(([0], tb)), np.concatenate((tb, [len(cell)]))

    index = {}
    for s, e in zip(t_starts, t_ends):
        tid = int(tile[s])
        ty, tx = divmod(tid, 36)
        c = cell[s:e]
        cb = np.flatnonzero(np.diff(c)) + 1
        c_starts = np.concatenate(([0], cb))
        c_counts = np.diff(np.concatenate((c_starts, [len(c)])))
        ucell = c[c_starts]
        d = day[s:e].astype(np.int64)
        delta = np.diff(d, prepend=0)
        delta[c_starts] = d[c_starts]                      # first record of each cell is absolute
        head = bytearray(struct.pack("<IHH", 0x32424D45, len(ucell), 0))
        cit = ((ucell // NX) % TILE) * TILE + (ucell % NX) % TILE
        rta = np.clip(np.round(R_TA[ucell] * 100), 1, 65535).astype("<u2")
        rt = np.clip(np.round(R_T[ucell] * 100), 1, 65535).astype("<u2")
        rj = np.clip(np.round(R_J[ucell] * 100), 1, 65535).astype("<u2")
        for i in range(len(ucell)):
            head += struct.pack("<HHI", int(cit[i]), 0, int(c_counts[i])) + rta[i].tobytes() + rt[i].tobytes() + rj[i].tobytes()
        streams = [varint(delta), varint(t[s:e]), varint(a[s:e]), varint(v[s:e]), varint(j[s:e])]
        head += struct.pack("<5I", *(len(x) for x in streams))
        blob = gzip.compress(bytes(head) + b"".join(streams), compresslevel=9, mtime=0)
        (OUT / "tiles" / f"{tx}_{ty}.bin.gz").write_bytes(blob)
        index[f"{tx}_{ty}"] = [len(blob), int(e - s)]
    total = sum(x[0] for x in index.values())
    print(f"{len(index)} tiles, {total / 1e6:.1f} MB gzip, largest {max(x[0] for x in index.values()) / 1e6:.2f} MB")

    # ---- harmonized monthly climatology (map layer) ------------------------------------------------
    first_year = 2001
    last_year = last_date.year if (last_date.month, last_date.day) == (12, 31) else last_date.year - 1
    m = con.execute(
        f"SELECT cell, month, era, sum(t) t, sum(a) a, sum(v) v, sum(j) j FROM '{WORK}/monthly.parquet' "
        f"WHERE year BETWEEN {first_year} AND {last_year} GROUP BY ALL"
    ).df()
    mi = m["month"].to_numpy(np.int64) - 1
    cc = m["cell"].to_numpy(np.int64)
    era = m["era"].to_numpy()
    h = np.where(era == 2, m["v"], np.where(era == 3, R_J[cc, mi] * m["j"],
                 np.where(era == 1, R_TA[cc, mi] * (m["t"] + m["a"]), R_T[cc, mi] * m["t"])))
    clim = np.zeros(NX * NY * 12)
    np.add.at(clim, cc * 12 + mi, h)
    clim = clim.reshape(-1, 12)
    n_years = last_year - first_year + 1
    days = np.array([calendar.monthrange(2001, k + 1)[1] for k in range(12)])
    clim = clim / (n_years * days)                         # mean harmonized detections per day
    keep = np.flatnonzero((clim * days).sum(axis=1) >= 0.2)    # at least one detection every 5 years
    q = np.clip(np.round(17 * np.log2(1 + 64 * clim[keep])), 0, 255).astype(np.uint8)
    # each cell's exchange rate (VIIRS per MODIS detection), averaged over the year by how much burns each month
    w = clim[keep] * days
    rate = (R_TA[keep] * w).sum(axis=1) / np.maximum(w.sum(axis=1), 1e-9)
    rate_q = np.clip(np.round(rate * 20), 1, 255).astype(np.uint8)
    blob = gzip.compress(struct.pack("<I", len(keep)) + keep.astype("<u4").tobytes() + q.tobytes() + rate_q.tobytes(), 9, mtime=0)
    (OUT / "clim.bin.gz").write_bytes(blob)
    print(f"climatology: {len(keep):,} cells, {len(blob) / 1e6:.2f} MB")

    meta = {
        "res": 0.25, "nx": NX, "ny": NY, "tileCells": TILE,
        "epoch": str(EPOCH),
        "lastDate": str(last_date),
        "lastDay": (last_date - EPOCH).days,
        "aquaStartDay": (AQUA_START - EPOCH).days,
        "viirsStartDay": (VIIRS_START - EPOCH).days,
        "firstDay": (dt.date.fromisoformat(min(c["first"] for c in report["coverage"])) - EPOCH).days,
        "climYears": [first_year, last_year],
        "viirsGapDays": [(dt.date.fromisoformat(d) - EPOCH).days for d in report.get("viirs_gap_days", [])],
        "noaa20Days": n20_days,
        "snppLastDay": (dt.date.fromisoformat(report["snpp_last_date"]) - EPOCH).days if report.get("snpp_last_date") else None,
        "tiles": index,
        "validation": report,
        "generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, separators=(",", ":")))
    print("meta written; last date", last_date)


if __name__ == "__main__":
    main()
