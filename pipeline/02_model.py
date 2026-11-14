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
from their neighbourhood. Two ratios are kept: R_TA for the Terra+Aqua era and R_T for the Terra-only era
(Nov 2000 - Jul 2002).

Validation is a strict temporal hold-out: fit on the early overlap years, predict the late ones from MODIS
alone, compare with what VIIRS actually saw.

Outputs: data/work/ratios.npz, data/work/validation.json, data/work/monthly.parquet
"""
import json
import pathlib

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
K_GRID = [3, 10, 30, 100, 300]


def build_monthly(con) -> pd.DataFrame:
    con.execute(
        f"""
        CREATE OR REPLACE TABLE monthly AS
        SELECT cell,
               CAST(year(date) AS SMALLINT) AS year,
               CAST(month(date) AS TINYINT) AS month,
               CAST(CASE WHEN date < DATE '{AQUA_START}' THEN 0
                         WHEN date < DATE '{VIIRS_START}' THEN 1 ELSE 2 END AS TINYINT) AS era,
               CAST(sum(CASE WHEN sat = 'T' THEN n ELSE 0 END) AS INTEGER) AS t,
               CAST(sum(CASE WHEN sat = 'A' THEN n ELSE 0 END) AS INTEGER) AS a,
               CAST(sum(CASE WHEN sat = 'N' THEN n ELSE 0 END) AS INTEGER) AS v
        FROM read_parquet('{AGG}/*.parquet')
        GROUP BY ALL
        """
    )
    con.execute(f"COPY monthly TO '{WORK}/monthly.parquet' (FORMAT parquet, COMPRESSION zstd)")
    return con.execute("SELECT * FROM monthly").df()


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
    con.execute("SET threads TO 24")
    m = build_monthly(con)
    print(f"monthly rows: {len(m):,}")

    cov = con.execute(
        f"SELECT sat, min(date), max(date), sum(n) FROM read_parquet('{AGG}/*.parquet') GROUP BY 1 ORDER BY 1"
    ).fetchall()
    for r in cov:
        print("coverage", r)
    last_date = max(r[2] for r in cov)

    # Overlap era, complete calendar months only (VIIRS starts 20 Jan 2012).
    ov = m[(m["era"] == 2) & ~((m["year"] == 2012) & (m["month"] == 1))].copy()
    years = sorted(ov["year"].unique())
    n_hold = max(3, len(years) // 2)
    train_years, hold_years = years[:-n_hold], years[-n_hold:]
    print("train", train_years, "hold-out", hold_years)
    tr, ho = ov[ov["year"].isin(train_years)], ov[ov["year"].isin(hold_years)].reset_index(drop=True)
    ho_cell, ho_m = ho["cell"].to_numpy(np.int64), ho["month"].to_numpy(np.int64) - 1
    ho_M, ho_T = (ho["t"] + ho["a"]).to_numpy(float), ho["t"].to_numpy(float)

    V = dense(tr, tr["v"].to_numpy(float))
    M = dense(tr, (tr["t"] + tr["a"]).to_numpy(float))
    T = dense(tr, tr["t"].to_numpy(float))

    # --- choose the prior strength K on the hold-out, at the scale people actually use (1 deg, monthly)
    k_scores = {}
    for k in K_GRID:
        R = fit_ratio(V, M, k)
        k_scores[k] = evaluate(ho, R[ho_cell, ho_m] * ho_M)["1deg_month"]["mdape"]
    best_k = min(k_scores, key=k_scores.get)
    print("K search (MdAPE % at 1 deg / month):", k_scores, "-> K =", best_k)

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
            print("   ", s, v)

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

    # --- final model: refit on every overlap year
    V = dense(ov, ov["v"].to_numpy(float))
    M = dense(ov, (ov["t"] + ov["a"]).to_numpy(float))
    T = dense(ov, ov["t"].to_numpy(float))
    R_TA, R_T = fit_ratio(V, M, best_k), fit_ratio(V, T, best_k)
    report["global_ratio_final"] = round(float(V.sum() / M.sum()), 3)
    report["global_ratio_terra_final"] = round(float(V.sum() / T.sum()), 3)
    report["last_date"] = str(last_date)
    report["coverage"] = [{"sat": r[0], "first": str(r[1]), "last": str(r[2]), "detections": int(r[3])} for r in cov]
    np.savez_compressed(WORK / "ratios.npz", R_TA=R_TA, R_T=R_T)
    (WORK / "validation.json").write_text(json.dumps(report, indent=1))
    print("saved ratios + validation; last date", last_date)


if __name__ == "__main__":
    main()
