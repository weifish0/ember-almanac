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
            <div><b>Learn the exchange rate where they overlap.</b> VIIRS sees {v.global_ratio_final.toFixed(1)}× more fire pixels than MODIS worldwide, but the rate depends on what burns: field stubble and forest crown fire differ several-fold. So the ratio is learned per grid cell and per month from the years both flew.</div>
          </li>
          <li>
            <div><b>Borrow strength, don’t guess.</b> Cells with few fires lean on their 1° neighbourhood, then their 5° block, then the global rate — a gamma-Poisson shrinkage, so sparse places get a stable ratio and busy places keep their own.</div>
          </li>
          <li>
            <div><b>Restate MODIS in VIIRS terms.</b> Before 2012 the calendar shows MODIS detections × the local ratio (a separate ratio for the Terra-only months of 2000–02). From 2012 it shows VIIRS as observed. Raw counts stay one hover away.</div>
          </li>
        </ol>
        <div className="proof">
          <p className="proof-lede">
            Tested on years the model never saw: ratios fitted on {tr[0]}–{tr[tr.length - 1]}, then MODIS alone used to predict what VIIRS recorded in {ho[0]}–{ho[ho.length - 1]}.
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
                    <td>{a.bias_pct > 0 ? '+' : '−'}{Math.abs(a.bias_pct).toFixed(0)}%</td>
                    <td>{b.within_25pct.toFixed(0)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {ours && rawBias !== undefined && (
            <p className="proof-note">
              Splicing raw records would understate pre-2012 fire by {Math.abs(rawBias).toFixed(0)}%. After harmonization the residual bias is {Math.abs(ours.bias_pct).toFixed(0)}%.
              {series && Number.isFinite(series.meanRatio) ? ` In the area you selected the applied ratio averages ${series.meanRatio.toFixed(2)}.` : ''}
            </p>
          )}
          <p className="proof-note quiet">
            Limits: a detection is a hot pixel at overpass time, not a fire or a burned area; cloud and smoke hide fires from both sensors; pre-2012 values are estimates and carry the interval shown in the yearly chart. Data: NASA FIRMS archive, {v.coverage.reduce((s, c) => s + c.detections, 0).toLocaleString()} screened detections through {v.last_date}.
          </p>
        </div>
      </div>
    </section>
  )
}
