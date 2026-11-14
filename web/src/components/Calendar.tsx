import { useEffect, useRef, useState } from 'react'
import { dateToDay, isLeap, type Meta, type Series } from '../lib/data'
import { SCORCH } from '../lib/color'
import { DOY_N, MONTHS, MONTH_START, doyLabel, fmt, type Almanac } from '../lib/stats'
import { useWidth } from '../lib/useWidth'

type Props = {
  meta: Meta
  series: Series
  almanac: Almanac
  smooth: boolean
  year: number | null
  onYear: (y: number | null) => void
}

const GUTTER_L = 38
const GUTTER_R = 26
const TOP = 30
const ROW = 15

export function Calendar({ meta, series, almanac, smooth, year, onYear }: Props) {
  const [wrap, width] = useWidth<HTMLDivElement>()
  const canvas = useRef<HTMLCanvasElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; year: number; doy: number } | null>(null)
  const years = almanac.years
  const height = TOP + years.length * ROW + 4
  const plotW = Math.max(100, width - GUTTER_L - GUTTER_R)

  useEffect(() => {
    const c = canvas.current
    if (!c || !width) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    c.width = Math.round(width * dpr)
    c.height = Math.round(height * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const ink = getComputedStyle(c).getPropertyValue('--ink').trim() || '#2a1d17'
    const soft = getComputedStyle(c).getPropertyValue('--ink-soft').trim() || '#7a6657'
    const cw = plotW / DOY_N
    const max = Math.sqrt(almanac.scaleMax)

    // season window + month ticks
    ctx.font = '500 10.5px "Instrument Sans", sans-serif'
    ctx.textBaseline = 'alphabetic'
    if (almanac.season) {
      const { start, length, peak } = almanac.season
      ctx.fillStyle = 'rgba(222, 98, 32, 0.9)'
      const seg = (a: number, len: number) => ctx.fillRect(GUTTER_L + a * cw, TOP - 7, len * cw, 3)
      if (start + length <= DOY_N) seg(start, length)
      else {
        seg(start, DOY_N - start)
        seg(0, start + length - DOY_N)
      }
      ctx.fillStyle = ink
      const px = GUTTER_L + (peak + 0.5) * cw
      ctx.beginPath()
      ctx.moveTo(px - 4, TOP - 12)
      ctx.lineTo(px + 4, TOP - 12)
      ctx.lineTo(px, TOP - 5)
      ctx.fill()
    }
    ctx.fillStyle = soft
    MONTHS.forEach((m, i) => ctx.fillText(m, GUTTER_L + MONTH_START[i] * cw + 2, 11))

    // rows
    years.forEach((y, r) => {
      const row = (smooth ? almanac.smooth : almanac.daily)[r]
      const y0 = TOP + r * ROW
      for (let k = 0; k < DOY_N; k++) {
        const v = row[k]
        const x0 = Math.floor(GUTTER_L + k * cw)
        const x1 = Math.ceil(GUTTER_L + (k + 1) * cw)
        if (Number.isNaN(v)) continue
        const t = Math.min(1, Math.sqrt(v) / max)
        const i = Math.round(t * 255) * 4
        ctx.fillStyle = `rgb(${SCORCH[i]},${SCORCH[i + 1]},${SCORCH[i + 2]})`
        ctx.fillRect(x0, y0, x1 - x0, ROW - 1.5)
      }
      const selected = y === year
      ctx.fillStyle = selected ? ink : soft
      ctx.font = `${selected ? 700 : 500} 10.5px "Instrument Sans", sans-serif`
      ctx.textAlign = 'right'
      ctx.fillText(String(y), GUTTER_L - 7, y0 + ROW - 4.5)
      ctx.textAlign = 'left'
      if (selected) {
        ctx.strokeStyle = ink
        ctx.lineWidth = 1.2
        ctx.strokeRect(GUTTER_L - 0.5, y0 - 0.75, plotW + 1, ROW)
      }
    })

    // month grid lines
    ctx.strokeStyle = 'rgba(42, 29, 23, 0.16)'
    ctx.lineWidth = 1
    for (let i = 1; i < 12; i++) {
      const x = Math.round(GUTTER_L + MONTH_START[i] * cw) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, TOP - 2)
      ctx.lineTo(x, TOP + years.length * ROW)
      ctx.stroke()
    }

    // sensor eras, right gutter
    const eraBracket = (fromYear: number, toYear: number, label: string, strong: boolean) => {
      const a = TOP + (fromYear - years[0]) * ROW + 1
      const b = TOP + (toYear - years[0] + 1) * ROW - 3
      if (b <= a) return
      const x = GUTTER_L + plotW + 7.5
      ctx.strokeStyle = strong ? ink : soft
      ctx.lineWidth = strong ? 1.6 : 1
      ctx.beginPath()
      ctx.moveTo(x - 3, a)
      ctx.lineTo(x, a)
      ctx.lineTo(x, b)
      ctx.lineTo(x - 3, b)
      ctx.stroke()
      ctx.save()
      ctx.translate(x + 12, (a + b) / 2)
      ctx.rotate(Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.fillStyle = strong ? ink : soft
      ctx.font = '600 9.5px "Instrument Sans", sans-serif'
      ctx.fillText(label, 0, 0)
      ctx.restore()
    }
    eraBracket(years[0], 2011, 'MODIS → VIIRS-EQUIVALENT', false)
    eraBracket(2012, years[years.length - 1], 'VIIRS OBSERVED', true)
  }, [almanac, smooth, width, height, plotW, year, years])

  const locate = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const k = Math.floor(((x - GUTTER_L) / plotW) * DOY_N)
    const ri = Math.floor((y - TOP) / ROW)
    if (k < 0 || k >= DOY_N || ri < 0 || ri >= years.length) return null
    return { x, y, year: years[ri], doy: k }
  }

  let tipBody = null
  if (tip) {
    const d = dateToDay(tip.year, 0, 1) + tip.doy + (isLeap(tip.year) && tip.doy >= 59 ? 1 : 0)
    const inRange = d >= meta.firstDay && d <= meta.lastDay
    const est = inRange ? series.est[d] === 1 : false
    const outage = est && d >= meta.viirsStartDay
    tipBody = (
      <div className="tip" style={{ left: Math.min(width - 190, Math.max(0, tip.x - 90)), top: tip.y + 18 }}>
        <strong>
          {doyLabel(tip.doy)}, {tip.year}
        </strong>
        {inRange ? (
          <>
            <span className="tip-big">
              {fmt(series.harm[d])} <small>{est ? 'VIIRS-equivalent (estimated)' : 'VIIRS detections'}</small>
            </span>
            <span className="tip-raw">
              raw · Terra {series.terra[d]} · Aqua {d >= meta.aquaStartDay ? series.aqua[d] : '—'} · VIIRS {outage ? 'outage' : est ? '—' : series.viirs[d]}
            </span>
          </>
        ) : (
          <span className="tip-raw">no satellite record</span>
        )}
      </div>
    )
  }

  return (
    <div className="calendar" ref={wrap}>
      <canvas
        ref={canvas}
        style={{ width: '100%', height }}
        onMouseMove={(e) => setTip(locate(e))}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => {
          const p = locate(e)
          if (p) onYear(p.year === year ? null : p.year)
        }}
      />
      {tipBody}
    </div>
  )
}
