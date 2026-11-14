import { useState } from 'react'
import { DOY_N, MONTHS, MONTH_START, doyLabel, fmt, type Almanac } from '../lib/stats'
import { useWidth } from '../lib/useWidth'

const niceMax = (v: number) => {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const m = v / p
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p
}

/** The normal seasonal cycle (percentile bands across all years) with one year laid over it. */
export function SeasonChart({ almanac, year }: { almanac: Almanac; year: number | null }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const H = 220
  const L = 38
  const R = 26
  const T = 12
  const B = 26
  const pw = Math.max(50, W - L - R)
  const ph = H - T - B
  const c = almanac.clim
  const yr = year !== null ? almanac.smooth[year - almanac.years[0]] : null
  let max = 0
  for (let k = 0; k < DOY_N; k++) max = Math.max(max, c.p90[k], yr && !Number.isNaN(yr[k]) ? yr[k] : 0)
  max = niceMax(max * 1.02)
  const x = (k: number) => L + (k / (DOY_N - 1)) * pw
  const y = (v: number) => T + ph - (v / max) * ph
  const line = (a: Float32Array) => {
    let d = ''
    let pen = false
    for (let k = 0; k < DOY_N; k++) {
      if (Number.isNaN(a[k])) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(a[k]).toFixed(1)}`
      pen = true
    }
    return d
  }
  const band = (lo: Float32Array, hi: Float32Array) => {
    let d = ''
    for (let k = 0; k < DOY_N; k++) d += `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(hi[k]).toFixed(1)}`
    for (let k = DOY_N - 1; k >= 0; k--) d += `L${x(k).toFixed(1)},${y(lo[k]).toFixed(1)}`
    return d + 'Z'
  }
  const s = almanac.season
  const seasonRects = s
    ? s.start + s.length <= DOY_N
      ? [[s.start, s.length]]
      : [[s.start, DOY_N - s.start], [0, s.start + s.length - DOY_N]]
    : []
  return (
    <div ref={ref} className="chart">
      {W > 0 && (
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="Seasonal cycle of burning activity"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            const k = Math.round(((e.clientX - r.left - L) / pw) * (DOY_N - 1))
            setHover(k >= 0 && k < DOY_N ? k : null)
          }}
          onMouseLeave={() => setHover(null)}
        >
          {seasonRects.map(([a, len], i) => (
            <rect key={i} x={x(a)} y={T} width={(len / (DOY_N - 1)) * pw} height={ph} className="season-band" />
          ))}
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={L + pw} y1={y(max * f)} y2={y(max * f)} className="grid" />
              <text x={L - 6} y={y(max * f) + 3.5} textAnchor="end" className="tick">
                {fmt(max * f)}
              </text>
            </g>
          ))}
          <path d={band(c.p10, c.p90)} className="band-outer" />
          <path d={band(c.p25, c.p75)} className="band-inner" />
          <path d={line(c.p50)} className="median" />
          {yr && <path d={line(yr)} className="year-line" />}
          {MONTHS.map((m, i) => (
            <text key={m} x={x(MONTH_START[i]) + 2} y={H - 8} className="tick">
              {m}
            </text>
          ))}
          {s && (
            <g>
              <line x1={x(s.peak)} x2={x(s.peak)} y1={T} y2={T + ph} className="peak-line" />
              <text x={x(s.peak) + (s.peak > 300 ? -5 : 5)} y={T + 10} textAnchor={s.peak > 300 ? 'end' : 'start'} className="peak-label">
                normal peak · {doyLabel(s.peak)}
              </text>
            </g>
          )}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + ph} className="hover-line" />
              <text x={x(hover) + (hover > 250 ? -6 : 6)} y={T + 26} textAnchor={hover > 250 ? 'end' : 'start'} className="hover-label">
                {doyLabel(hover)} · median {fmt(c.p50[hover])}/day
                {yr && !Number.isNaN(yr[hover]) ? ` · ${year}: ${fmt(yr[hover])}` : ''}
              </text>
            </g>
          )}
        </svg>
      )}
      <div className="legend">
        <span><i className="sw sw-outer" /> 10–90th percentile</span>
        <span><i className="sw sw-inner" /> middle half of years</span>
        <span><i className="sw sw-median" /> median</span>
        {year !== null && <span><i className="sw sw-year" /> {year}</span>}
        {s && <span><i className="sw sw-season" /> fire season (80% of burning)</span>}
      </div>
    </div>
  )
}

/** Year totals: VIIRS observed, MODIS harmonized with its interval, and the raw MODIS count for contrast. */
export function AnnualChart({ almanac, year, onYear }: { almanac: Almanac; year: number | null; onYear: (y: number | null) => void }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const H = 230
  const L = 38
  const R = 26
  const T = 14
  const B = 24
  const rows = almanac.annual.filter((a) => a.year >= 2001)
  const pw = Math.max(50, W - L - R)
  const ph = H - T - B
  const max = niceMax(Math.max(...rows.map((r) => Math.max(r.hi, r.total))) * 1.02)
  const bw = pw / rows.length
  const x = (i: number) => L + i * bw
  const y = (v: number) => T + ph - (v / max) * ph
  const rawLine = rows.map((r, i) => `${i ? 'L' : 'M'}${(x(i) + bw / 2).toFixed(1)},${y(r.rawModis).toFixed(1)}`).join('')
  return (
    <div ref={ref} className="chart">
      {W > 0 && (
        <svg width={W} height={H} role="img" aria-label="Burning activity by year">
          <defs>
            <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" className="hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="5" className="hatch-line" />
            </pattern>
          </defs>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={L + pw} y1={y(max * f)} y2={y(max * f)} className="grid" />
              <text x={L - 6} y={y(max * f) + 3.5} textAnchor="end" className="tick">
                {fmt(max * f)}
              </text>
            </g>
          ))}
          <line x1={L} x2={L + pw} y1={y(almanac.meanAnnual)} y2={y(almanac.meanAnnual)} className="mean-line" />
          {rows.map((r, i) => {
            const est = r.estimated / Math.max(r.total, 1e-9) > 0.5
            return (
              <g key={r.year} onClick={() => onYear(r.year === year ? null : r.year)} className="bar-g">
                <title>
                  {r.year}: {fmt(r.total)} VIIRS-equivalent detections{est ? ` (80% interval ${fmt(r.lo)}–${fmt(r.hi)})` : ''} · raw MODIS {fmt(r.rawModis)}
                  {r.terraOnly ? ' · Terra only, not used in the statistics' : r.complete ? '' : ' · year in progress'}
                </title>
                <rect x={x(i)} y={T} width={bw} height={ph} fill="transparent" />
                <rect
                  x={x(i) + 1.5}
                  y={y(r.total)}
                  width={Math.max(1, bw - 3)}
                  height={Math.max(0, T + ph - y(r.total))}
                  className={`bar ${est ? 'bar-est' : 'bar-obs'} ${r.year === year ? 'bar-on' : ''} ${r.complete ? '' : 'bar-partial'}`}
                />
                {est && (
                  <line x1={x(i) + bw / 2} x2={x(i) + bw / 2} y1={y(r.hi)} y2={y(r.lo)} className="whisker" />
                )}
                {(i % 2 === 0 || bw > 26) && (
                  <text x={x(i) + bw / 2} y={H - 7} textAnchor="middle" className={`tick ${r.year === year ? 'tick-on' : ''}`}>
                    {bw > 26 ? r.year : `'${String(r.year).slice(2)}`}
                  </text>
                )}
              </g>
            )
          })}
          <path d={rawLine} className="raw-line" />
          {rows.map((r, i) => (
            <circle key={r.year} cx={x(i) + bw / 2} cy={y(r.rawModis)} r={1.8} className="raw-dot" />
          ))}
        </svg>
      )}
      <div className="legend">
        <span><i className="sw sw-obs" /> VIIRS observed</span>
        <span><i className="sw sw-est" /> MODIS harmonized, with 80% interval</span>
        <span><i className="sw sw-raw" /> raw MODIS count</span>
        <span><i className="sw sw-mean" /> long-run mean</span>
      </div>
    </div>
  )
}
