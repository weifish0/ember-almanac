// Colour ramps. Two families: "scorch" for paper (calendar, charts) and "glow" for the dark map plate.
type Stop = [number, number, number, number, number?] // t, r, g, b, a

function ramp(stops: Stop[], n = 256): Uint8ClampedArray {
  const out = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    let k = 0
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++
    const a = stops[k]!
    const b = stops[k + 1]!
    const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])))
    for (let c = 0; c < 3; c++) out[i * 4 + c] = (a[c + 1] as number) + ((b[c + 1] as number) - (a[c + 1] as number)) * u
    out[i * 4 + 3] = ((a[4] ?? 1) + ((b[4] ?? 1) - (a[4] ?? 1)) * u) * 255
  }
  return out
}

/** Paper -> straw -> amber -> vermilion -> oxblood -> char. Reads as heat marks on paper. */
export const SCORCH = ramp([
  [0, 236, 226, 207],
  [0.08, 243, 214, 150],
  [0.28, 240, 164, 62],
  [0.5, 222, 98, 32],
  [0.72, 172, 40, 28],
  [0.88, 104, 22, 22],
  [1, 38, 14, 12],
])

/** Transparent -> ember red -> orange -> yellow -> white heat, for the dark basemap. */
export const GLOW = ramp([
  [0, 120, 20, 10, 0],
  [0.06, 150, 24, 12, 0.55],
  [0.3, 214, 52, 16, 0.85],
  [0.55, 246, 128, 28, 0.95],
  [0.8, 255, 206, 84, 1],
  [1, 255, 248, 214, 1],
])

export function scorchCss(t: number): string {
  const i = Math.min(255, Math.max(0, Math.round(t * 255))) * 4
  return `rgb(${SCORCH[i]},${SCORCH[i + 1]},${SCORCH[i + 2]})`
}

/** One colour per month for the "when does it peak" map - a cyclic wheel so Dec sits next to Jan. */
export const MONTH_COLORS: [number, number, number][] = [
  [86, 132, 226], // Jan
  [70, 176, 222], // Feb
  [64, 204, 178], // Mar
  [104, 204, 96], // Apr
  [178, 210, 62], // May
  [240, 208, 50], // Jun
  [250, 164, 44], // Jul
  [244, 110, 44], // Aug
  [232, 62, 62], // Sep
  [214, 62, 140], // Oct
  [168, 82, 206], // Nov
  [116, 100, 228], // Dec
]
