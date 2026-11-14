// Loading and decoding of the static data files produced by /pipeline.
// Everything below runs in the browser: the tiles carry *raw* Terra / Aqua / S-NPP counts and the
// per-cell monthly ratios, and the harmonization is applied here, in the open.

export type Score = { n: number; r_log: number; mdape: number; within_25pct: number; within_2x: number; bias_pct: number }
export type ErrBin = { log10_lo: number; log10_hi: number; n: number; q10: number; q25: number; q50: number; q75: number; q90: number }
export type Validation = {
  train_years: number[]
  holdout_years: number[]
  k: number
  global_ratio_train: number
  global_ratio_final: number
  global_ratio_terra_final: number
  methods: Record<string, Record<string, Score>>
  error_model: ErrBin[]
  global_ratio_by_year: Record<string, number>
  raw_totals_by_year: Record<string, { terra: number; aqua: number; viirs: number }>
  coverage: { sat: string; first: string; last: string; detections: number }[]
  last_date: string
  snpp_last_date?: string | null
  noaa20?: { train_years: number[]; holdout_years: number[]; global_ratio: number; methods: Record<string, Record<string, Score>> }
  final_fit_years?: [number, number]
  ratio_spread?: { p05: number; p50: number; p95: number }
}
export type Meta = {
  res: number
  nx: number
  ny: number
  tileCells: number
  epoch: string
  lastDate: string
  lastDay: number
  firstDay: number
  aquaStartDay: number
  viirsStartDay: number
  climYears: [number, number]
  /** days when VIIRS was not observing (sensor outage); filled from MODIS like the pre-VIIRS era */
  viirsGapDays?: number[]
  /** days when NOAA-20 VIIRS stands in for S-NPP (S-NPP outages, and everything after S-NPP stopped) */
  noaa20Days?: number[]
  snppLastDay?: number | null
  tiles: Record<string, [number, number]>
  validation: Validation
  generated: string
}

// Browser-ready data lives in a public Google Cloud Storage bucket, written by the pipeline (see cloudbuild.yaml).
const BASE = (import.meta.env.VITE_DATA_BASE as string | undefined) ?? 'https://storage.googleapis.com/ember-almanac-ffe3bb/v1'

async function fetchBin(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const buf = await res.arrayBuffer()
  const head = new Uint8Array(buf, 0, 2)
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf // already inflated by the server / CDN
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).arrayBuffer()
}

export async function loadMeta(): Promise<Meta> {
  const res = await fetch(`${BASE}/meta.json`)
  if (!res.ok) throw new Error('meta.json missing')
  return res.json()
}

// ---------------------------------------------------------------------------------------------
// Calendar helpers (day index = days since 2000-01-01)
const DAY_MS = 86400000
const EPOCH_MS = Date.UTC(2000, 0, 1)
export const dayToDate = (d: number) => new Date(EPOCH_MS + d * DAY_MS)
export const dateToDay = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m, d) - EPOCH_MS) / DAY_MS)
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0

export type DayTable = { month: Uint8Array; year: Uint16Array; doy: Uint16Array }
let dayTable: DayTable | null = null
/** month (0-11), year and 365-day day-of-year (29 Feb folded onto 28 Feb) for every day index. */
export function getDayTable(n: number): DayTable {
  if (dayTable && dayTable.month.length >= n) return dayTable
  const month = new Uint8Array(n)
  const year = new Uint16Array(n)
  const doy = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    const dt = dayToDate(i)
    const y = dt.getUTCFullYear()
    month[i] = dt.getUTCMonth()
    year[i] = y
    let k = i - dateToDay(y, 0, 1)
    if (isLeap(y) && k >= 59) k -= 1
    doy[i] = k
  }
  dayTable = { month, year, doy }
  return dayTable
}

// ---------------------------------------------------------------------------------------------
// Tiles
export type Tile = {
  tx: number
  ty: number
  nCells: number
  cit: Uint16Array // cell-in-tile index (row * 40 + col, row 0 = south)
  start: Uint32Array // record offset of each cell (length nCells + 1)
  rta: Uint16Array // nCells * 12, VIIRS per (Terra+Aqua) detection, x100
  rt: Uint16Array // nCells * 12, VIIRS per Terra detection, x100
  rj: Uint16Array // nCells * 12, S-NPP VIIRS per NOAA-20 VIIRS detection, x100
  day: Uint16Array
  t: Uint16Array
  a: Uint16Array
  v: Uint16Array
  j: Uint16Array // NOAA-20, only on the days it stands in for S-NPP
}

function readVarints(bytes: Uint8Array, out: Uint16Array) {
  let p = 0
  for (let i = 0; i < out.length; i++) {
    let b = bytes[p++]
    let val = b & 0x7f
    let shift = 7
    while (b & 0x80) {
      b = bytes[p++]
      val |= (b & 0x7f) << shift
      shift += 7
    }
    out[i] = val
  }
}

function decodeTile(buf: ArrayBuffer, tx: number, ty: number): Tile {
  const dv = new DataView(buf)
  const magic = dv.getUint32(0, true)
  const v2 = magic === 0x32424d45 // 'EMB2' adds the NOAA-20 ratios and stream
  if (!v2 && magic !== 0x31424d45) throw new Error('bad tile')
  const nCells = dv.getUint16(4, true)
  const cit = new Uint16Array(nCells)
  const start = new Uint32Array(nCells + 1)
  const rta = new Uint16Array(nCells * 12)
  const rt = new Uint16Array(nCells * 12)
  const rj = new Uint16Array(nCells * 12).fill(100)
  let p = 8
  let total = 0
  for (let i = 0; i < nCells; i++) {
    cit[i] = dv.getUint16(p, true)
    start[i] = total
    total += dv.getUint32(p + 4, true)
    for (let m = 0; m < 12; m++) {
      rta[i * 12 + m] = dv.getUint16(p + 8 + m * 2, true)
      rt[i * 12 + m] = dv.getUint16(p + 32 + m * 2, true)
      if (v2) rj[i * 12 + m] = dv.getUint16(p + 56 + m * 2, true)
    }
    p += v2 ? 80 : 56
  }
  start[nCells] = total
  const nStreams = v2 ? 5 : 4
  const lens = Array.from({ length: nStreams }, (_, k) => dv.getUint32(p + k * 4, true))
  p += nStreams * 4
  const cols = Array.from({ length: 5 }, () => new Uint16Array(total))
  for (let k = 0; k < nStreams; k++) {
    readVarints(new Uint8Array(buf, p, lens[k]), cols[k])
    p += lens[k]
  }
  // days are delta-coded inside each cell
  const day = cols[0]
  for (let i = 0; i < nCells; i++) for (let j = start[i] + 1; j < start[i + 1]; j++) day[j] += day[j - 1]
  return { tx, ty, nCells, cit, start, rta, rt, rj, day, t: cols[1], a: cols[2], v: cols[3], j: cols[4] }
}

const tileCache = new Map<string, Promise<Tile | null>>()
export function loadTile(meta: Meta, tx: number, ty: number): Promise<Tile | null> {
  const key = `${tx}_${ty}`
  if (!meta.tiles[key]) return Promise.resolve(null)
  let p = tileCache.get(key)
  if (!p) {
    p = fetchBin(`${BASE}/tiles/${key}.bin.gz`).then((b) => decodeTile(b, tx, ty))
    tileCache.set(key, p)
  }
  return p
}

// ---------------------------------------------------------------------------------------------
// Area of interest
export type BBox = [west: number, south: number, east: number, north: number]

/** Snap a bbox outward to the 0.25 degree analysis grid. */
export function snapBBox(b: BBox, res = 0.25): BBox {
  const w = Math.max(-180, Math.floor(b[0] / res) * res)
  const s = Math.max(-90, Math.floor(b[1] / res) * res)
  const e = Math.min(180, Math.ceil(b[2] / res) * res)
  const n = Math.min(90, Math.ceil(b[3] / res) * res)
  return [w, s, Math.max(e, w + res), Math.max(n, s + res)]
}

export function tilesFor(meta: Meta, b: BBox): { tx: number; ty: number; bytes: number }[] {
  const deg = meta.tileCells * meta.res
  const out = []
  for (let ty = Math.floor((b[1] + 90) / deg); ty <= Math.floor((b[3] + 90 - 1e-9) / deg); ty++)
    for (let tx = Math.floor((b[0] + 180) / deg); tx <= Math.floor((b[2] + 180 - 1e-9) / deg); tx++) {
      const t = meta.tiles[`${tx}_${ty}`]
      if (t) out.push({ tx, ty, bytes: t[0] })
    }
  return out
}

export type Series = {
  bbox: BBox
  nDays: number
  terra: Float32Array
  aqua: Float32Array
  viirs: Float32Array
  /** harmonized, VIIRS-equivalent detections per day */
  harm: Float32Array
  noaa20: Float32Array
  /** where each day's harmonized value comes from: 0 S-NPP VIIRS as observed, 1 MODIS x ratio, 2 NOAA-20 VIIRS x ratio */
  est: Uint8Array
  cellsWithFire: number
  cellsTotal: number
  records: number
  /** mean ratio actually applied in this area (detection weighted) */
  meanRatio: number
}

export async function loadSeries(meta: Meta, bbox: BBox, onProgress?: (done: number, total: number) => void): Promise<Series> {
  const nDays = meta.lastDay + 1
  const { month } = getDayTable(nDays)
  const terra = new Float32Array(nDays)
  const aqua = new Float32Array(nDays)
  const viirs = new Float32Array(nDays)
  const harm = new Float32Array(nDays)
  const est = new Uint8Array(nDays)
  est.fill(1, 0, Math.min(nDays, meta.viirsStartDay))
  for (const d of meta.viirsGapDays ?? []) if (d < nDays) est[d] = 1
  for (const d of meta.noaa20Days ?? []) if (d < nDays) est[d] = 2
  const noaa20 = new Float32Array(nDays)
  const res = meta.res
  const tc = meta.tileCells
  const x0 = Math.round((bbox[0] + 180) / res)
  const x1 = Math.round((bbox[2] + 180) / res) // exclusive
  const y0 = Math.round((bbox[1] + 90) / res)
  const y1 = Math.round((bbox[3] + 90) / res)
  const need = tilesFor(meta, bbox)
  let done = 0
  let cellsWithFire = 0
  let records = 0
  let ratioNum = 0
  let ratioDen = 0
  onProgress?.(0, need.length)
  await Promise.all(
    need.map(async ({ tx, ty }) => {
      const tile = await loadTile(meta, tx, ty)
      done++
      onProgress?.(done, need.length)
      if (!tile) return
      for (let i = 0; i < tile.nCells; i++) {
        const gx = tx * tc + (tile.cit[i] % tc)
        const gy = ty * tc + Math.floor(tile.cit[i] / tc)
        if (gx < x0 || gx >= x1 || gy < y0 || gy >= y1) continue
        cellsWithFire++
        const r0 = i * 12
        for (let k: number = tile.start[i]; k < tile.start[i + 1]; k++) {
          const d = tile.day[k]
          if (d >= nDays) continue
          const t = tile.t[k]
          const a = tile.a[k]
          const v = tile.v[k]
          terra[d] += t
          aqua[d] += a
          viirs[d] += v
          if (est[d] === 0) harm[d] += v
          else if (est[d] === 2) {
            noaa20[d] += tile.j[k]
            harm[d] += (tile.rj[r0 + month[d]] / 100) * tile.j[k]
          } else if (d >= meta.aquaStartDay) {
            const h = (tile.rta[r0 + month[d]] / 100) * (t + a)
            harm[d] += h
            ratioNum += h
            ratioDen += t + a
          } else harm[d] += (tile.rt[r0 + month[d]] / 100) * t
          records++
        }
      }
    }),
  )
  return {
    bbox,
    nDays,
    terra,
    aqua,
    viirs,
    noaa20,
    harm,
    est,
    cellsWithFire,
    cellsTotal: (x1 - x0) * (y1 - y0),
    records,
    meanRatio: ratioDen > 0 ? ratioNum / ratioDen : NaN,
  }
}

// ---------------------------------------------------------------------------------------------
// Global monthly climatology (map layer)
export type Clim = { cells: Uint32Array; q: Uint8Array /* n * 12, log coded */; rate: Uint8Array | null /* n, ratio x 20 */ }
export const decodeClim = (q: number) => (Math.pow(2, q / 17) - 1) / 64

export async function loadClim(): Promise<Clim> {
  const buf = await fetchBin(`${BASE}/clim.bin.gz`)
  const n = new DataView(buf).getUint32(0, true)
  const rate = buf.byteLength >= 4 + n * 17 ? new Uint8Array(buf, 4 + n * 16, n) : null
  return { cells: new Uint32Array(buf.slice(4, 4 + n * 4)), q: new Uint8Array(buf, 4 + n * 4, n * 12), rate }
}
