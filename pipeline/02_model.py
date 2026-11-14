"""Step 2 - Fit and validate the MODIS -> VIIRS harmonization model.

The two sensors cannot be compared directly: VIIRS (375 m) resolves several pixels where MODIS (1 km)
reports one, and it sees small / cool fires MODIS misses. How much more it sees depends on *what burns*:
a crop-residue landscape and a boreal crown-fire landscape have very different VIIRS/MODIS ratios, and the
ratio changes through the season. So one global scale factor is wrong almost everywhere.

Model: a hierarchical, seasonally varying detection-ratio
    VIIRS_equiv(cell, day) = R[cell, month] * MODIS(cell, day)
R is estimated from the overlap era (both sensors flying) as a ratio of sums, and each level of the
hierarchy  global -> 5 deg block -> 1 deg cell -> 0.25 deg cell  is shrunk toward its parent with a
gamma-Poisson prior worth K MODIS detections. Data-rich cells get their own local ratio; sparse cells borrow
from their neighbourhood. Three ratios are kept: R_TA for the Terra+Aqua era, R_T for the Terra-only era
(Nov 2000 - Jul 2002), and R_J, which restates NOAA-20 VIIRS in S-NPP terms so the record can continue after
S-NPP stopped delivering fire data (2 Nov 2026) and across S-NPP outages.

Validation is a backcast, the same direction as the real task: fit on the later stable-orbit overlap years,
reconstruct the earliest VIIRS years from MODIS alone, compare with what VIIRS actually saw.

Outputs: data/work/ratios.npz, data/work/validation.json, data/work/monthly.parquet
"""
import json
import pathlib
import sys

import duckdb
import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = ROOT / "data" / "work"
AGG = WORK / "agg"

NX, NY = 1440, 720
NCELL = NX * NY
AQUA_START = "2002-07-04"   # first Aqua MODIS fire detections in the archive
VIIRS_START = "2012-01-20"  # first S-NPP VIIRS 375 m detections
K_GRID = [10, 30, 100, 300]
STABLE_UNTIL = 2021         # last year before Terra/Aqua orbit drift affects detections
N20_START = "2018-04-01"    # NOAA-20 VIIRS science-quality record begins


def find_gaps(con) -> tuple[list[str], list[str], list[str]]:
    """Classify the days when the reference sensor (S-NPP VIIRS) was not observing.

    The global VIIRS/MODIS detection ratio sits near 4 every single day, so a day below 2 means the VIIRS in
    question returned little or nothing: a safe-mode outage (27 Jul - 10 Aug 2022), or the end of the mission
    (S-NPP stopped delivering fire data on 2 Nov 2026). Such days are excluded from the fits and filled:
      * from NOAA-20 VIIRS x its own ratio, when NOAA-20 was healthy that day (same instrument design,
        50 minutes apart on the same orbit - by far the closer stand-in);
      * otherwise from MODIS x ratio, exactly like the pre-VIIRS era.
    Returns (days filled from MODIS, days filled from NOAA-20, days when NOAA-20 itself was out).
    """
    rows = con.execute(
        f"""
        SELECT date, sum(CASE WHEN sat = 'N' THEN n ELSE 0 END) AS v,
                     sum(CASE WHEN sat = 'J' THEN n ELSE 0 END) AS j,
                     sum(CASE WHEN sat IN ('T', 'A') THEN n ELSE 0 END) AS m
        FROM read_parquet('{AGG}/*.parquet') WHERE date >= DATE '{VIIRS_START}' GROUP BY date ORDER BY date
        """
    ).fetchall()
    modis_fill, n20_fill, n20_out = [], [], []
    for date, v, j, m in rows:
        n20_ok = str(date) >= N20_START and j >= 2.0 * m and j > 0
        if str(date) >= N20_START and not n20_ok:
            n20_out.append(str(date))
        if v < 2.0 * m:
            (n20_fill if n20_ok else modis_fill).append(str(date))
    return modis_fill, n20_fill, n20_out


def date_list(days: list[str]) -> str:
    return ", ".join(f"DATE '{d}'" for d in days) or "DATE '1900-01-01'"


def build_monthly(con, modis_fill: list[str], n20_fill: list[str], n20_out: list[str]) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Monthly sums per cell, split by which sensor the harmonized value comes from (era):
    0 Terra only, 1 MODIS (Terra + Aqua) x ratio, 2 S-NPP VIIRS as observed, 3 NOAA-20 VIIRS x ratio.
    Also returns the S-NPP / NOAA-20 overlap (days both were healthy) used to learn the NOAA-20 ratio."""
    con.execute(
        f"""
        CREATE OR REPLACE TABLE monthly AS
        SELECT cell,
               CAST(year(date) AS SMALLINT) AS year,
               CAST(month(date) AS TINYINT) AS month,
               CAST(CASE WHEN date < DATE '{AQUA_START}' THEN 0
                         WHEN date < DATE '{VIIRS_START}' OR date IN ({date_list(modis_fill)}) THEN 1
                         WHEN date IN ({date_list(n20_fill)}) THEN 3 ELSE 2 END AS TINYINT) AS era,
               CAST(sum(CASE WHEN sat = 'T' THEN n ELSE 0 END) AS INTEGER) AS t,
               CAST(sum(CASE WHEN sat = 'A' THEN n ELSE 0 END) AS INTEGER) AS a,
               CAST(sum(CASE WHEN sat = 'N' THEN n ELSE 0 END) AS INTEGER) AS v,
               CAST(sum(CASE WHEN sat = 'J' THEN n ELSE 0 END) AS INTEGER) AS j
        FROM read_parquet('{AGG}/*.parquet')
        GROUP BY ALL
        """
    )
    con.execute(f"COPY monthly TO '{WORK}/monthly.parquet' (FORMAT parquet, COMPRESSION zstd)")
    con.execute(
        f"""
        COPY (
          SELECT cell, CAST(year(date) AS SMALLINT) AS year, CAST(month(date) AS TINYINT) AS month,
                 CAST(sum(CASE WHEN sat = 'N' THEN n ELSE 0 END) AS INTEGER) AS v,
                 CAST(sum(CASE WHEN sat = 'J' THEN n ELSE 0 END) AS INTEGER) AS j
          FROM read_parquet('{AGG}/*.parquet')
          WHERE date >= DATE '{N20_START}' AND sat IN ('N', 'J')
            AND date NOT IN ({date_list(modis_fill + n20_fill + n20_out)})
          GROUP BY ALL
        ) TO '{WORK}/overlap_j.parquet' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    return con.execute("SELECT * FROM monthly").df(), con.execute(f"SELECT * FROM '{WORK}/overlap_j.parquet'").df()


def dense(df: pd.DataFrame, col) -> np.ndarray:
    """Sum a column onto a dense [NCELL, 12] array."""
    out = np.zeros(NCELL * 12, dtype=np.float64)
    np.add.at(out, df["cell"].to_numpy(np.int64) * 12 + (df["month"].to_numpy(np.int64) - 1), col)
    return out.reshape(NCELL, 12)


def season_smooth(x: np.ndarray) -> np.ndarray:
    """Pool each month with its two neighbours (circular) - the fire regime changes smoothly."""
    return x + np.roll(x, 1, axis=1) + np.roll(x, -1, axis=1)


def coarsen(x: np.ndarray, f: int) -> np.ndarray:
    g = x.reshape(NY, NX, 12)
    return g.reshape(NY // f, f, NX // f, f, 12).sum(axis=(1, 3))


def expand(x: np.ndarray, f: int) -> np.ndarray:
    return np.repeat(np.repeat(x, f, axis=0), f, axis=1).reshape(NCELL, 12)


def fit_ratio(V: np.ndarray, M: np.ndarray, k: float) -> np.ndarray:
    """Hierarchical shrinkage ratio R[cell, month] of VIIRS per MODIS detection."""
    Vs, Ms = season_smooth(V), season_smooth(M)
    r_global = Vs.sum(axis=0) / np.maximum(Ms.sum(axis=0), 1)          # [12]
    r5 = (coarsen(Vs, 20) + k * r_global) / (coarsen(Ms, 20) + k)      # 5 deg blocks
    r1 = (coarsen(Vs, 4) + k * np.repeat(np.repeat(r5, 5, 0), 5, 1)) / (coarsen(Ms, 4) + k)  # 1 deg
    rc = (Vs + k * expand(r1, 4)) / (Ms + k)                           # 0.25 deg
    return rc.astype(np.float32)


def scales(df: pd.DataFrame) -> dict:
    iy, ix = df["cell"] // NX, df["cell"] % NX
    ym = df["year"] * 12 + df["month"]
    return {
        "0.25deg_month": [df["cell"], ym],
        "1deg_month": [(iy // 4) * 360 + ix // 4, ym],
        "5deg_month": [(iy // 20) * 72 + ix // 20, ym],
        "5deg_year": [(iy // 20) * 72 + ix // 20, df["year"]],
        "global_month": [ym],
    }


def score(obs: np.ndarray, pred: np.ndarray) -> dict:
    lo, lp = np.log1p(obs), np.log1p(pred)
    big = obs >= 20
    ratio = (pred[big] + 0.5) / (obs[big] + 0.5)
    return {
        "n": int(len(obs)),
        "r_log": round(float(np.corrcoef(lo, lp)[0, 1]), 4),
        "mdape": round(float(np.median(np.abs(pred[big] - obs[big]) / obs[big])) * 100, 1),
        "within_25pct": round(float(np.mean(np.abs(np.log(ratio)) < np.log(1.25))) * 100, 1),
        "within_2x": round(float(np.mean(np.abs(np.log(ratio)) < np.log(2))) * 100, 1),
        "bias_pct": round(float(pred.sum() / obs.sum() - 1) * 100, 1),
    }


def evaluate(hold: pd.DataFrame, pred: np.ndarray) -> dict:
    d = hold.assign(pred=pred)
    out = {}
    for name, keys in scales(d).items():
        g = d.groupby(keys, sort=False)[["v", "pred"]].sum()
        out[name] = score(g["v"].to_numpy(float), g["pred"].to_numpy(float))
    return out


def main():
    con = duckdb.connect()
    con.execute("SET threads TO 8")
    if "--from-monthly" in sys.argv:   # quick local iteration without the gridded daily files
        m = con.execute(f"SELECT * FROM '{WORK}/monthly.parquet'").df()
        prev_report = json.loads((WORK / "validation.json").read_text())
        gaps, n20_days = prev_report.get("viirs_gap_days", []), prev_report.get("noaa20_days", [])
        ovj = con.execute(f"SELECT * FROM '{WORK}/overlap_j.parquet'").df()
        cov = [(c["sat"], c["first"], c["last"], c["detections"]) for c in prev_report["coverage"]]
    else:
        gaps, n20_days, n20_out = find_gaps(con)
        m, ovj = build_monthly(con, gaps, n20_days, n20_out)
        cov = con.execute(
            f"SELECT sat, min(date), max(date), sum(n) FROM read_parquet('{AGG}/*.parquet') GROUP BY 1 ORDER BY 1"
        ).fetchall()
    print(f"monthly rows: {len(m):,}", flush=True)
    for r in cov:
        print("coverage", r)
    last_date = max(r[2] for r in cov)

    # Overlap era, complete calendar months only (VIIRS starts 20 Jan 2012).
    ov = m[(m["era"] == 2) & ~((m["year"] == 2012) & (m["month"] == 1))].copy()
    # Terra and Aqua began drifting from their nominal overpass times in 2022, which changes what MODIS
    # detects. The pre-VIIRS record we need to translate was flown at nominal orbits, so the model is
    # learned only from the stable-orbit overlap years.
    stable = [y for y in sorted(ov["year"].unique()) if y <= STABLE_UNTIL]
    # Validation mirrors the real task - going *back* in time: learn from the later years, reconstruct
    # the earliest VIIRS years from MODIS alone. K is tuned on an inner split so the test years stay unseen.
    hold_years, train_years = stable[:3], stable[3:]
    inner_val, inner_train = train_years[:3], train_years[3:]
    print("train", train_years, "backcast hold-out", hold_years, flush=True)

    def split(tr_years, ho_years):
        tr, ho = ov[ov["year"].isin(tr_years)], ov[ov["year"].isin(ho_years)].reset_index(drop=True)
        return (dense(tr, tr["v"].to_numpy(float)), dense(tr, (tr["t"] + tr["a"]).to_numpy(float)),
                dense(tr, tr["t"].to_numpy(float)), ho, ho["cell"].to_numpy(np.int64),
                ho["month"].to_numpy(np.int64) - 1, (ho["t"] + ho["a"]).to_numpy(float), ho["t"].to_numpy(float))

    V, M, T, ho, ho_cell, ho_m, ho_M, ho_T = split(inner_train, inner_val)
    k_scores = {k: evaluate(ho, fit_ratio(V, M, k)[ho_cell, ho_m] * ho_M)["1deg_month"]["mdape"] for k in K_GRID}
    best_k = min(k_scores, key=k_scores.get)
    print("K search on inner split (MdAPE % at 1 deg / month):", k_scores, "-> K =", best_k, flush=True)

    V, M, T, ho, ho_cell, ho_m, ho_M, ho_T = split(train_years, hold_years)
    R_TA = fit_ratio(V, M, best_k)
    R_T = fit_ratio(V, T, best_k)
    g_ratio = V.sum() / M.sum()
    report = {
        "train_years": [int(y) for y in train_years],
        "holdout_years": [int(y) for y in hold_years],
        "k": best_k,
        "k_search": {str(k): v for k, v in k_scores.items()},
        "global_ratio_train": round(float(g_ratio), 3),
        "methods": {
            "raw_modis": evaluate(ho, ho_M),
            "global_factor": evaluate(ho, g_ratio * ho_M),
            "hierarchical": evaluate(ho, R_TA[ho_cell, ho_m] * ho_M),
            "hierarchical_terra_only": evaluate(ho, R_T[ho_cell, ho_m] * ho_T),
        },
    }
    for name, res in report["methods"].items():
        print(name)
        for s, v in res.items():
            print("   ", s, v, flush=True)

    # --- what orbit drift does: apply the stable-era model to the drift years
    drift = ov[ov["year"] > STABLE_UNTIL].reset_index(drop=True)
    if len(drift):
        st = ov[ov["year"].isin(stable)]
        Rs = fit_ratio(dense(st, st["v"].to_numpy(float)), dense(st, (st["t"] + st["a"]).to_numpy(float)), best_k)
        pred = Rs[drift["cell"].to_numpy(np.int64), drift["month"].to_numpy(np.int64) - 1] * (drift["t"] + drift["a"]).to_numpy(float)
        report["drift_years_check"] = {"years": [int(y) for y in sorted(drift["year"].unique())], **{
            k: v for k, v in evaluate(drift, pred).items() if k in ("1deg_month", "5deg_year")}}
        print("drift check", report["drift_years_check"], flush=True)

    # --- empirical error model: multiplicative error of an aggregated estimate vs its size
    d = ho.assign(pred=R_TA[ho_cell, ho_m] * ho_M)
    iy, ix = d["cell"] // NX, d["cell"] % NX
    pooled = []
    for keys in ([(iy // 4) * 360 + ix // 4, d["year"] * 12 + d["month"]],
                 [(iy // 20) * 72 + ix // 20, d["year"] * 12 + d["month"]],
                 [(iy // 20) * 72 + ix // 20, d["year"]]):
        pooled.append(d.groupby(keys, sort=False)[["v", "pred"]].sum())
    p = pd.concat(pooled)
    p = p[p["pred"] >= 1]
    logerr = np.log((p["v"] + 0.5) / (p["pred"] + 0.5)).to_numpy()
    mag = np.log10(p["pred"].to_numpy())
    edges = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 9]
    err_model = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        sel = (mag >= lo) & (mag < hi)
        if sel.sum() < 30:
            continue
        q = np.quantile(logerr[sel], [0.1, 0.25, 0.5, 0.75, 0.9])
        err_model.append({"log10_lo": lo, "log10_hi": hi, "n": int(sel.sum()),
                          "q10": round(float(np.exp(q[0])), 3), "q25": round(float(np.exp(q[1])), 3),
                          "q50": round(float(np.exp(q[2])), 3), "q75": round(float(np.exp(q[3])), 3),
                          "q90": round(float(np.exp(q[4])), 3)})
    report["error_model"] = err_model

    # --- stability of the raw sensor ratio through time (orbit drift, sensor ageing)
    yr = ov.groupby("year")[["t", "a", "v"]].sum()
    report["global_ratio_by_year"] = {
        int(y): round(float(r.v / max(r.t + r.a, 1)), 3) for y, r in yr.iterrows()
    }
    report["raw_totals_by_year"] = {
        int(y): {"terra": int(r.t), "aqua": int(r.a), "viirs": int(r.v)}
        for y, r in m.groupby("year")[["t", "a", "v"]].sum().iterrows()
    }

    # --- final model: refit on every stable-orbit overlap year
    st = ov[ov["year"].isin(stable)]
    V = dense(st, st["v"].to_numpy(float))
    M = dense(st, (st["t"] + st["a"]).to_numpy(float))
    T = dense(st, st["t"].to_numpy(float))
    R_TA, R_T = fit_ratio(V, M, best_k), fit_ratio(V, T, best_k)
    report["final_fit_years"] = [int(stable[0]), int(stable[-1])]
    # how much the exchange rate varies: percentiles of the applied ratio, weighted by pre-VIIRS MODIS detections
    pre = m[(m["era"] == 1) & (m["year"] < 2012)]
    rr = R_TA[pre["cell"].to_numpy(np.int64), pre["month"].to_numpy(np.int64) - 1]
    ww = (pre["t"] + pre["a"]).to_numpy(float)
    order = np.argsort(rr)
    cw = np.cumsum(ww[order]) / ww.sum()
    report["ratio_spread"] = {f"p{int(q * 100):02d}": round(float(rr[order][np.searchsorted(cw, q)]), 2) for q in (0.05, 0.5, 0.95)}
    report["global_ratio_final"] = round(float(V.sum() / M.sum()), 3)
    report["global_ratio_terra_final"] = round(float(V.sum() / T.sum()), 3)
    report["last_date"] = str(last_date)
    report["viirs_gap_days"] = gaps
    report["noaa20_days"] = n20_days
    print("S-NPP outage days filled from MODIS:", len(gaps), "| from NOAA-20:", len(n20_days), flush=True)

    # --- the continuity sensor: NOAA-20 VIIRS restated in S-NPP terms, learned where both were observing.
    # Here the real task runs forward in time (after S-NPP ends), so the hold-out is the latest years.
    R_J = np.ones((NCELL, 12), dtype=np.float32)
    snpp_last = max((str(r[2]) for r in cov if r[0] == "N"), default=None)
    report["snpp_last_date"] = snpp_last
    if len(ovj):
        ovj = ovj[ovj["year"] <= 2025]
        jy = sorted(ovj["year"].unique())
        j_hold, j_train = jy[-3:], jy[:-3]
        tr, hj = ovj[ovj["year"].isin(j_train)], ovj[ovj["year"].isin(j_hold)].reset_index(drop=True)
        Rj = fit_ratio(dense(tr, tr["v"].to_numpy(float)), dense(tr, tr["j"].to_numpy(float)), best_k)
        hc, hm, hJ = hj["cell"].to_numpy(np.int64), hj["month"].to_numpy(np.int64) - 1, hj["j"].to_numpy(float)
        gj = float(tr["v"].sum() / tr["j"].sum())
        report["noaa20"] = {
            "train_years": [int(y) for y in j_train], "holdout_years": [int(y) for y in j_hold],
            "global_ratio": round(float(ovj["v"].sum() / ovj["j"].sum()), 3),
            "methods": {"raw_noaa20": evaluate(hj, hJ), "global_factor": evaluate(hj, gj * hJ),
                        "hierarchical": evaluate(hj, Rj[hc, hm] * hJ)},
        }
        for name, res in report["noaa20"]["methods"].items():
            print("NOAA-20", name, res["1deg_month"], res["5deg_year"], flush=True)
        R_J = fit_ratio(dense(ovj, ovj["v"].to_numpy(float)), dense(ovj, ovj["j"].to_numpy(float)), best_k)
    report["coverage"] = [{"sat": r[0], "first": str(r[1]), "last": str(r[2]), "detections": int(r[3])} for r in cov]
    np.savez_compressed(WORK / "ratios.npz", R_TA=R_TA, R_T=R_T, R_J=R_J)
    (WORK / "validation.json").write_text(json.dumps(report, indent=1))
    print("saved ratios + validation; last date", last_date)


if __name__ == "__main__":
    main()
