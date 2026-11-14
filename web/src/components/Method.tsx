import type { Meta, Series } from '../lib/data'

const ROWS: [key: string, label: string, note: string][] = [
  ['raw_modis', 'Splice the raw counts', 'treat a MODIS detection as a VIIRS detection'],
  ['global_factor', 'One global scale factor', 'multiply MODIS by the world-average ratio'],
  ['hierarchical', 'Ember Almanac', 'local, seasonal ratio with neighbourhood pooling'],
]

/** How the two satellite records were joined, and how well it works on years the model never saw. */
export function Method({ meta, series }: { meta: Meta; series: Series | null }) {
  const v = meta.validation
  const m = v.methods
  const ho = v.holdout_years
  const tr = v.train_years
  const ours = m.hierarchical?.['1deg_month']
  const rawBias = m.raw_modis?.['1deg_month']?.bias_pct
  return (
    <section className="method">
      <div className="sec-head"><h2>How the two records were joined</h2></div>
      <div className="method-cols">
        <ol className="steps">
          <li>
            <div><b>Same rules for both sensors.</b> Every NASA FIRMS detection from MODIS (Terra and Aqua, 1 km, since 2000) and VIIRS (Suomi NPP, 375 m, since 2012) is screened the same way — vegetation fires only, low-confidence detections dropped — and counted on one 0.25° daily grid.</div>
          </li>
          <li>
            <div><b>Learn the exchange rate where they overlap.</b> VIIRS sees {v.global_ratio_final.toFixed(1)}× more fire pixels than MODIS worldwide, but the rate is not a constant{v.ratio_spread ? ` — it runs from ${v.ratio_spread.p05.toFixed(1)}× to ${v.ratio_spread.p95.toFixed(1)}× across the burning world` : ''}, and it shifts through the season. So the ratio is learned per grid cell and per month from the years both flew.</div>
          </li>
          <li>
            <div><b>Borrow strength, don’t guess.</b> Cells with few fires lean on their 1° neighbourhood, then their 5° block, then the global rate — a gamma-Poisson shrinkage, so sparse places get a stable ratio and busy places keep their own.</div>
          </li>
          <li>
            <div><b>Restate MODIS in VIIRS terms.</b> Before 2012 the calendar shows MODIS detections × the local ratio (a separate ratio for the Terra-only months of 2000–02). From 2012 it shows Suomi NPP VIIRS as observed{meta.viirsGapDays?.length ? `, except ${meta.viirsGapDays.length} outage days that MODIS fills the same way` : ''}. Raw counts stay one hover away.</div>
          </li>
          {v.noaa20 && meta.noaa20Days?.length ? (
            <li>
              <div>
                <b>Carry on when the reference stops.</b> Suomi NPP delivered its last fire data on {v.snpp_last_date}. From then on, and on {meta.noaa20Days.filter((d) => d <= (meta.snppLastDay ?? 0)).length} earlier outage days, the record continues on NOAA-20 VIIRS — the same instrument design — restated through its own local ratio ({v.noaa20.global_ratio.toFixed(2)}× worldwide). On held-out years ({v.noaa20.holdout_years[0]}–{v.noaa20.holdout_years[v.noaa20.holdout_years.length - 1]}) that hand-over has a typical error of {v.noaa20.methods.hierarchical['1deg_month'].mdape.toFixed(0)}% per 1° cell and month, and {v.noaa20.methods.hierarchical['5deg_year'].mdape.toFixed(0)}% per region and year.
              </div>
            </li>
          ) : null}
        </ol>
        <div className="proof">
          <p className="proof-lede">
            Tested by backcasting, the same direction as the real task: ratios learned from {tr[0]}–{tr[tr.length - 1]}, then MODIS alone used to rebuild {ho[0]}–{ho[ho.length - 1]} — the earliest VIIRS years — and compared with what VIIRS actually recorded.
          </p>
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Typical error<small>1° cell, one month</small></th>
                <th>Overall bias</th>
                <th>Within ±25%<small>5° block, one year</small></th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([k, label, note]) => {
                const a = m[k]?.['1deg_month']
                const b = m[k]?.['5deg_year']
                if (!a || !b) return null
                return (
                  <tr key={k} className={k === 'hierarchical' ? 'ours' : ''}>
                    <td>{label}<small>{note}</small></td>
                    <td>{a.mdape.toFixed(0)}%</td>
                    <td>{a.bias_pct > 0 ? '+' : '−'}{Math.abs(a.bias_pct).toFixed(Math.abs(a.bias_pct) < 1 ? 1 : 0)}%</td>
                    <td>{b.within_25pct.toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {ours && rawBias !== undefined && (
            <p className="proof-note">
              Splicing the raw records would understate pre-2012 fire by {Math.abs(rawBias).toFixed(0)}%. After harmonization the residual bias is {Math.abs(ours.bias_pct).toFixed(Math.abs(ours.bias_pct) < 1 ? 1 : 0)}%.
              {series && Number.isFinite(series.meanRatio) ? ` In the area you selected the applied ratio averages ${series.meanRatio.toFixed(2)}.` : ''}
            </p>
          )}
          <p className="proof-note quiet">
            Limits: a detection is a hot pixel at overpass time, not a fire or a burned area; cloud and smoke hide fires from both sensors. Harmonization restores how much burned, not the exact day: MODIS misses small fires outright, so read pre-2012 at weekly scale or coarser, with the interval shown in the yearly chart. Ratios are learned from {v.final_fit_years ? `${v.final_fit_years[0]}–${v.final_fit_years[1]}` : 'the overlap years'}, before Terra and Aqua began drifting from their nominal orbits. Data: NASA FIRMS archive, {v.coverage.reduce((s, c) => s + c.detections, 0).toLocaleString()} screened detections through {v.last_date}.
          </p>
        </div>
      </div>
    </section>
  )
}
