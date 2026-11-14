// Turns a harmonized daily series for an area into its "almanac": the burning calendar, the normal
// seasonal cycle, the fire season window, year-by-year totals with uncertainty, trend, and unusual episodes.
import { dateToDay, getDayTable, isLeap, type ErrBin, type Meta, type Series } from './data'

export const DOY_N = 365
export const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type Episode = {
  startDay: number
  endDay: number
  peakDay: number
  year: number
  total: number
  normal: number
  ratio: number
  score: number
  offSeason: boolean
}
export type Annual = {
  year: number
  total: number
  estimated: number // part of total that is a MODIS-based estimate
  lo: number
  hi: number
  anomalyPct: number
  rawModis: number
  rawViirs: number
  complete: boolean
  /** before both MODIS instruments were flying for a whole year: shown, not used in statistics */
  terraOnly: boolean
}
/** A stretch of the normal year when burning is under way (there can be more than one, e.g. two harvests). */
export type Period = { start: number; end: number; length: number; share: number; peak: number }
export type Season = { start: number; end: number; peak: number; length: number; share: number; concentration: number }
export type Almanac = {
  years: number[]
  fullYears: number[]
  daily: Float32Array[] // [year][doy] harmonized detections, NaN = no observation
  smooth: Float32Array[] // [year][doy] 7-day mean
  clim: { mean: Float32Array; p10: Float32Array; p25: Float32Array; p50: Float32Array; p75: Float32Array; p90: Float32Array }
  monthShare: number[]
  season: Season | null
  periods: Period[]
  annual: Annual[]
  meanAnnual: number
  trend: { slopePct: number; p: number; tau: number } | null
  episodes: Episode[]
  latest: { year: number; throughDoy: number; cumulative: number; normal: number; percentile: number; ratio: number } | null
  /** the most recent fortnight against the same fortnight in every complete year */
  recent: { fromDay: number; toDay: number; total: number; normal: number; percentile: number; ratio: number; rank: number; of: number } | null
  scaleMax: number
  sparse: boolean
}

export function doyLabel(doy: number): string {
  let m = 11
  while (MONTH_START[m] > doy) m--
  return `${MONTHS[m]} ${doy - MONTH_START[m] + 1}`
}

function quantileSorted(a: number[], q: number): number {
  if (!a.length) return 0
  const p = (a.length - 1) * q
  const lo = Math.floor(p)
  const hi = Math.ceil(p)
  return a[lo] + (a[hi] - a[lo]) * (p - lo)
}

function circSmooth(a: Float32Array, half: number): Float32Array {
  const n = a.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = -half; k <= half; k++) s += a[(i + k + n) % n]
    out[i] = s / (2 * half + 1)
  }
  return out
}

function errFactor(bins: ErrBin[], value: number): { lo: number; hi: number } {
  if (!bins.length || value <= 0) return { lo: 1, hi: 1 }
  const m = Math.log10(Math.max(value, 1))
  let b = bins[bins.length - 1]
  for (const x of bins)
    if (m >= x.log10_lo && m < x.log10_hi) {
      b = x
      break
    }
  if (m < bins[0].log10_lo) b = bins[0]
  return { lo: b.q10, hi: b.q90 }
}

function mannKendall(y: number[]): { tau: number; p: number; slope: number } {
  const n = y.length
  let s = 0
  const slopes: number[] = []
  for (let i = 0; i < n - 1; i++)
    for (let j = i + 1; j < n; j++) {
      s += Math.sign(y[j] - y[i])
      slopes.push((y[j] - y[i]) / (j - i))
    }
  slopes.sort((a, b) => a - b)
  const varS = (n * (n - 1) * (2 * n + 5)) / 18
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0
  // two-sided p from the normal distribution
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const tail = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return { tau: s / ((n * (n - 1)) / 2), p: Math.min(1, 2 * tail), slope: quantileSorted(slopes, 0.5) }
}

export function buildAlmanac(meta: Meta, s: Series): Almanac {
  const nDays = s.nDays
  const tab = getDayTable(nDays)
  const firstYear = tab.year[meta.firstDay]
  const lastYear = tab.year[meta.lastDay]
  const years: number[] = []
  for (let y = 2000; y <= lastYear; y++) years.push(y)
  const lastComplete = tab.month[meta.lastDay] === 11 && meta.lastDay === dateToDay(lastYear, 11, 31) ? lastYear : lastYear - 1
  // Statistics use complete years with both MODIS instruments flying (2003 on). The Terra-only start of the
  // record (Nov 2000 - Jul 2002) is still drawn in the calendar, but its estimates are too noisy to rank against.
  const firstStatYear = Math.max(firstYear + 1, tab.year[meta.aquaStartDay] + 1)
  const fullYears = years.filter((y) => y >= firstStatYear && y <= lastComplete)

  // 7-day centred mean on the continuous series
  const sm = new Float32Array(nDays)
  for (let d = meta.firstDay; d <= meta.lastDay; d++) {
    let sum = 0
    let n = 0
    for (let k = -3; k <= 3; k++) {
      const j = d + k
      if (j >= meta.firstDay && j <= meta.lastDay) {
        sum += s.harm[j]
        n++
      }
    }
    sm[d] = sum / n
  }

  const daily = years.map(() => new Float32Array(DOY_N).fill(NaN))
  const smooth = years.map(() => new Float32Array(DOY_N).fill(NaN))
  for (let d = meta.firstDay; d <= meta.lastDay; d++) {
    const yi = tab.year[d] - 2000
    const k = tab.doy[d]
    const isFeb29 = isLeap(tab.year[d]) && d === dateToDay(tab.year[d], 1, 29)
    daily[yi][k] = (isFeb29 || !Number.isNaN(daily[yi][k]) ? daily[yi][k] || 0 : 0) + s.harm[d]
    if (!isFeb29) smooth[yi][k] = sm[d]
  }

  // normal seasonal cycle across complete years
  const mk = () => new Float32Array(DOY_N)
  const raw = { mean: mk(), p10: mk(), p25: mk(), p50: mk(), p75: mk(), p90: mk() }
  for (let k = 0; k < DOY_N; k++) {
    const vals: number[] = []
    for (const y of fullYears) {
      const v = smooth[y - 2000][k]
      if (!Number.isNaN(v)) vals.push(v)
    }
    vals.sort((a, b) => a - b)
    raw.mean[k] = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)
    raw.p10[k] = quantileSorted(vals, 0.1)
    raw.p25[k] = quantileSorted(vals, 0.25)
    raw.p50[k] = quantileSorted(vals, 0.5)
    raw.p75[k] = quantileSorted(vals, 0.75)
    raw.p90[k] = quantileSorted(vals, 0.9)
  }
  const clim = {
    mean: circSmooth(raw.mean, 5),
    p10: circSmooth(raw.p10, 5),
    p25: circSmooth(raw.p25, 5),
    p50: circSmooth(raw.p50, 5),
    p75: circSmooth(raw.p75, 5),
    p90: circSmooth(raw.p90, 5),
  }

  // yearly totals
  const totalMean = clim.mean.reduce((a, b) => a + b, 0)
  const err = meta.validation.error_model
  const annualRaw = years.map((y) => {
    let total = 0
    let estimated = 0
    let rawModis = 0
    let rawViirs = 0
    const d0 = Math.max(meta.firstDay, dateToDay(y, 0, 1))
    const d1 = Math.min(meta.lastDay, dateToDay(y, 11, 31))
    for (let d = d0; d <= d1; d++) {
      total += s.harm[d]
      if (s.est[d] === 1) estimated += s.harm[d] // MODIS-based days carry the interval; NOAA-20 is the same instrument
      rawModis += s.terra[d] + s.aqua[d]
      rawViirs += s.viirs[d]
    }
    return { year: y, total, estimated, rawModis, rawViirs, complete: fullYears.includes(y), terraOnly: y < firstStatYear }
  })
  const fullTotals = annualRaw.filter((a) => a.complete).map((a) => a.total)
  const meanAnnual = fullTotals.reduce((a, b) => a + b, 0) / Math.max(1, fullTotals.length)
  const annual: Annual[] = annualRaw.map((a) => {
    const f = errFactor(err, a.estimated)
    const obs = a.total - a.estimated
    return {
      ...a,
      lo: obs + a.estimated * f.lo,
      hi: obs + a.estimated * f.hi,
      anomalyPct: meanAnnual > 0 ? (a.total / meanAnnual - 1) * 100 : 0,
    }
  })
  const sparse = meanAnnual < 25

  // month shares + fire season (shortest window holding 80 % of normal activity)
  const monthShare = MONTH_START.map((st, m) => {
    const en = m === 11 ? DOY_N : MONTH_START[m + 1]
    let x = 0
    for (let k = st; k < en; k++) x += clim.mean[k]
    return totalMean > 0 ? x / totalMean : 0
  })
  let season: Season | null = null
  if (totalMean > 0 && !sparse) {
    const cm = circSmooth(clim.mean, 7)
    let peak = 0
    for (let k = 1; k < DOY_N; k++) if (cm[k] > cm[peak]) peak = k
    let best = { start: 0, len: DOY_N, sum: totalMean }
    const target = 0.8 * totalMean
    for (let st = 0; st < DOY_N; st++) {
      let sum = 0
      for (let len = 1; len <= DOY_N && len < best.len; len++) {
        sum += clim.mean[(st + len - 1) % DOY_N]
        if (sum >= target) {
          best = { start: st, len, sum }
          break
        }
      }
    }
    season = {
      start: best.start,
      end: (best.start + best.len - 1) % DOY_N,
      peak,
      length: best.len,
      share: best.sum / totalMean,
      concentration: best.sum / totalMean / (best.len / DOY_N),
    }
  }

  // burning periods: stretches where the normal curve stays above a fifth of its peak
  const periods: Period[] = []
  if (season) {
    const cm = circSmooth(clim.mean, 7)
    const thr = 0.2 * Math.max(...cm)
    const on = Array.from(cm, (v) => v > thr)
    // close gaps shorter than 15 days (circular)
    for (let k = 0; k < DOY_N; k++) {
      if (on[k] || !on[(k - 1 + DOY_N) % DOY_N]) continue
      let len = 0
      while (len < 15 && !on[(k + len) % DOY_N]) len++
      if (len < 15) for (let j = 0; j < len; j++) on[(k + j) % DOY_N] = true
    }
    if (on.some((v) => !v)) {
      let st = 0
      while (on[st]) st++ // start scanning from an "off" day so runs don't straddle the array end
      for (let i = 1; i <= DOY_N; i++) {
        const k = (st + i) % DOY_N
        if (!on[k]) continue
        let len = 0
        let sum = 0
        let pk = k
        while (len < DOY_N && on[(k + len) % DOY_N]) {
          const j = (k + len) % DOY_N
          sum += clim.mean[j]
          if (cm[j] > cm[pk]) pk = j
          len++
        }
        if (sum / totalMean >= 0.08 && len >= 10) periods.push({ start: k, end: (k + len - 1) % DOY_N, length: len, share: sum / totalMean, peak: pk })
        i += len
      }
      periods.sort((a, b) => a.start - b.start)
    }
  }

  // trend over complete years
  let trend: Almanac['trend'] = null
  if (fullTotals.length >= 10 && meanAnnual > 0) {
    const r = mannKendall(fullTotals)
    const med = quantileSorted([...fullTotals].sort((a, b) => a - b), 0.5)
    trend = { slopePct: med > 0 ? (r.slope / med) * 100 : 0, p: r.p, tau: r.tau }
  }

  // unusual episodes: at least 5 days above the 90th percentile for that time of year
  const episodes: Episode[] = []
  if (!sparse) {
    const peakMean = Math.max(...clim.mean)
    const floor = Math.max(0.15 * peakMean, 0.5)
    let run: number[] = []
    let gap = 0
    const flush = () => {
      if (run.length >= 5) {
        const st = run[0]
        const en = run[run.length - 1]
        let total = 0
        let normal = 0
        let score = 0
        let pk = st
        for (let d = st; d <= en; d++) {
          const k = tab.doy[d]
          total += s.harm[d]
          normal += clim.p50[k]
          score += Math.max(0, sm[d] - clim.p75[k])
          if (sm[d] > sm[pk]) pk = d
        }
        const inSeason = season ? ((tab.doy[pk] - season.start + DOY_N) % DOY_N) < season.length : true
        episodes.push({
          startDay: st, endDay: en, peakDay: pk, year: tab.year[pk], total, normal,
          ratio: total / Math.max(normal, 1), score, offSeason: !inSeason,
        })
      }
      run = []
      gap = 0
    }
    for (let d = Math.max(meta.firstDay, meta.aquaStartDay); d <= meta.lastDay; d++) {
      const k = tab.doy[d]
      if (sm[d] > clim.p90[k] && sm[d] >= floor) {
        run.push(d)
        gap = 0
      } else if (run.length && ++gap > 3) flush()
    }
    flush()
    episodes.sort((a, b) => b.score - a.score)
    episodes.splice(12)
  }

  // where the most recent year stands
  let latest: Almanac['latest'] = null
  {
    const y = lastYear
    const through = tab.doy[meta.lastDay]
    const cumOf = (yy: number) => {
      let c = 0
      const row = daily[yy - 2000]
      for (let k = 0; k <= through; k++) if (!Number.isNaN(row[k])) c += row[k]
      return c
    }
    const ref = fullYears.filter((yy) => yy !== y).map(cumOf).sort((a, b) => a - b)
    const cum = cumOf(y)
    const normal = quantileSorted(ref, 0.5)
    if (ref.length)
      latest = {
        year: y, throughDoy: through, cumulative: cum, normal,
        percentile: (ref.filter((v) => v < cum).length / ref.length) * 100,
        ratio: normal > 0 ? cum / normal : NaN,
      }
  }

  // the last two weeks (leaving out the final two days, which near-real-time data has not finished filling)
  let recent: Almanac['recent'] = null
  {
    const to = meta.lastDay - 2
    const from = to - 13
    if (from > meta.firstDay && fullYears.length >= 10) {
      let total = 0
      for (let d = from; d <= to; d++) total += s.harm[d]
      const ref = fullYears
        .map((yy) => {
          let c = 0
          for (let d = from; d <= to; d++) {
            const v = daily[yy - 2000][tab.doy[d]]
            if (!Number.isNaN(v)) c += v
          }
          return c
        })
        .sort((a, b) => a - b)
      const normal = quantileSorted(ref, 0.5)
      const below = ref.filter((v) => v < total).length
      recent = { fromDay: from, toDay: to, total, normal, percentile: (below / ref.length) * 100, ratio: normal > 0 ? total / normal : NaN, rank: ref.length - below + 1, of: ref.length + 1 }
    }
  }

  // colour scale: 99.5th percentile of non-zero daily values
  const nz: number[] = []
  for (let d = meta.firstDay; d <= meta.lastDay; d++) if (s.harm[d] > 0) nz.push(s.harm[d])
  nz.sort((a, b) => a - b)
  const scaleMax = Math.max(1, quantileSorted(nz, 0.995))

  return { years, fullYears, daily, smooth, clim, monthShare, season, periods, annual, meanAnnual, trend, episodes, latest, recent, scaleMax, sparse }
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '–'
  const a = Math.abs(n)
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M'
  if (a >= 1e4) return Math.round(n / 1e3) + 'k'
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'k'
  if (a >= 100) return Math.round(n).toString()
  if (a >= 10) return n.toFixed(0)
  return n.toFixed(1).replace(/\.0$/, '')
}
