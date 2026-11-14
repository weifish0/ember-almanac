import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapView, type MapMode } from './components/MapView'
import { Calendar } from './components/Calendar'
import { AnnualChart, SeasonChart } from './components/Charts'
import { Method } from './components/Method'
import { MONTH_COLORS } from './lib/color'
import { dayToDate, decodeClim, loadClim, loadMeta, loadSeries, snapBBox, tilesFor, type BBox, type Clim, type Meta, type Series } from './lib/data'
import { PRESETS } from './lib/presets'
import { MONTHS, buildAlmanac, doyLabel, fmt, type Almanac, type Episode } from './lib/stats'

const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MAX_TILES = 20

function areaKm2(b: BBox): number {
  const R = 6371
  const rad = Math.PI / 180
  return R * R * (b[2] - b[0]) * rad * (Math.sin(b[3] * rad) - Math.sin(b[1] * rad))
}
const coord = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2).replace(/\.?0+$/, '')}°${v >= 0 ? pos : neg}`
const bboxLabel = (b: BBox) => `${coord(b[1], 'N', 'S')}–${coord(b[3], 'N', 'S')}, ${coord(b[0], 'E', 'W')}–${coord(b[2], 'E', 'W')}`
const shortDate = (day: number) => {
  const d = dayToDate(day)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function readHash(): { bbox: BBox; name: string | null } | null {
  const h = new URLSearchParams(location.hash.slice(1))
  const p = PRESETS.find((x) => x.id === h.get('place'))
  if (p) return { bbox: p.bbox, name: p.name }
  const b = h.get('bbox')?.split(',').map(Number)
  if (b && b.length === 4 && b.every(Number.isFinite)) return { bbox: snapBBox(b as BBox), name: null }
  return null
}

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [clim, setClim] = useState<Clim | null>(null)
  const [fatal, setFatal] = useState<string | null>(null)
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState<MapMode>('month')
  const [drawing, setDrawing] = useState(false)
  const [area, setArea] = useState<{ bbox: BBox; name: string | null } | null>(null)
  const [focus, setFocus] = useState<{ bbox: BBox; nonce: number } | null>(null)
  const [series, setSeries] = useState<Series | null>(null)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [smooth, setSmooth] = useState(true)
  const [hover, setHover] = useState<{ value: number; peak: number } | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const req = useRef(0)

  useEffect(() => {
    loadMeta().then(setMeta).catch((e) => setFatal(String(e.message ?? e)))
    loadClim().then(setClim).catch(() => {})
  }, [])

  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setMonth((m) => (m + 1) % 12), 900)
    return () => clearInterval(id)
  }, [playing])

  const select = useCallback(
    (bbox: BBox, name: string | null, fly: boolean) => {
      if (!meta) return
      setDrawing(false)
      const tiles = tilesFor(meta, bbox)
      if (tiles.length > MAX_TILES) {
        setNotice('That box spans too much of the planet to read as one fire regime. Draw something up to about 40° across.')
        return
      }
      setNotice(null)
      setArea({ bbox, name })
      if (fly) setFocus({ bbox, nonce: Date.now() })
      const p = PRESETS.find((x) => x.name === name)
      history.replaceState(null, '', p ? `#place=${p.id}` : `#bbox=${bbox.join(',')}`)
      const id = ++req.current
      setSeries(null)
      loadSeries(meta, bbox, (d, t) => id === req.current && setProgress([d, t]))
        .then((s) => {
          if (id !== req.current) return
          setSeries(s)
          setProgress(null)
          panel.current?.scrollTo({ top: 0 })
        })
        .catch(() => {
          if (id !== req.current) return
          setProgress(null)
          setNotice('Could not load the fire record for that area. Check your connection and try again.')
        })
    },
    [meta],
  )

  useEffect(() => {
    if (!meta) return
    const open = () => {
      const h = readHash()
      if (h) select(h.bbox, h.name, true)
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [meta, select])

  const almanac = useMemo(() => (meta && series ? buildAlmanac(meta, series) : null), [meta, series])
  useEffect(() => {
    if (!almanac) return
    setYear(almanac.years[almanac.years.length - 1])
    // show the map at this area's peak month, so the place lights up
    if (almanac.season) {
      const top = almanac.monthShare.indexOf(Math.max(...almanac.monthShare))
      setPlaying(false)
      setMode('month')
      setMonth(top)
    }
  }, [almanac])

  const clear = () => {
    req.current++
    setArea(null)
    setSeries(null)
    setProgress(null)
    history.replaceState(null, '', location.pathname)
  }

  const exportCsv = () => {
    if (!meta || !series || !area) return
    const rows = ['date,terra_modis,aqua_modis,snpp_viirs,harmonized_viirs_equivalent,is_estimate']
    for (let d = meta.firstDay; d <= meta.lastDay; d++) {
      const iso = dayToDate(d).toISOString().slice(0, 10)
      rows.push(`${iso},${series.terra[d]},${series.aqua[d]},${series.viirs[d]},${series.harm[d].toFixed(2)},${series.est[d]}`)
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
    a.download = `ember-almanac_${area.bbox.join('_')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (fatal)
    return (
      <div className="fatal">
        <h1>Ember Almanac</h1>
        <p>The fire record could not be loaded ({fatal}). Reload the page to try again.</p>
      </div>
    )

  const hoverValue = hover && clim ? decodeClim(clim.q[hover.value * 12 + month]) : null

  return (
    <div className="app">
      <div className="plate">
        {meta && (
          <MapView
            meta={meta}
            clim={clim}
            month={month}
            mode={mode}
            bbox={area?.bbox ?? null}
            drawing={drawing}
            focus={focus}
            onBBox={(b) => select(b, null, false)}
            onHover={setHover}
          />
        )}
        <div className="plate-top">
          <div className="seg" role="tablist" aria-label="Map layer">
            <button role="tab" aria-selected={mode === 'month'} onClick={() => setMode('month')}>
              Burning by month
            </button>
            <button role="tab" aria-selected={mode === 'peak'} onClick={() => { setMode('peak'); setPlaying(false) }}>
              Peak month
            </button>
          </div>
          {mode === 'month' ? (
            <div className="months">
              <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play the year'}>
                {playing ? (
                  <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1" width="3.2" height="10" /><rect x="7.3" y="1" width="3.2" height="10" /></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1l9 5-9 5z" /></svg>
                )}
              </button>
              {MONTHS.map((m, i) => (
                <button key={m} className={i === month ? 'on' : ''} onClick={() => { setMonth(i); setPlaying(false) }} aria-pressed={i === month}>
                  {m}
                </button>
              ))}
            </div>
          ) : (
            <div className="months wheel">
              {MONTHS.map((m, i) => (
                <span key={m} style={{ background: `rgb(${MONTH_COLORS[i].join(',')})` }}>
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="plate-bottom">
          <button className={`draw ${drawing ? 'on' : ''}`} onClick={() => setDrawing((d) => !d)}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="2" width="10" height="10" strokeDasharray="2.4 1.6" /></svg>
            {drawing ? 'Drag a box on the map…' : 'Draw an area'}
          </button>
          <div className="readout">
            {mode === 'month' ? (
              <>
                <div className="ramp" />
                <div className="ramp-labels"><span>rare</span><span>{MONTH_LONG[month]} · typical fire detections per day</span><span>intense</span></div>
              </>
            ) : (
              <div className="ramp-labels"><span>Colour = the month each place normally burns most</span></div>
            )}
            {hover && hoverValue !== null && (
              <div className="hover-read">
                {hoverValue >= 0.005 ? `${fmt(hoverValue)} per day in ${MONTHS[month]}` : `quiet in ${MONTHS[month]}`} · peaks in {MONTH_LONG[hover.peak]}
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="panel" ref={panel}>
        <header className="masthead">
          <a className="wordmark" href={location.pathname} onClick={(e) => { e.preventDefault(); clear() }}>
            Ember Almanac
          </a>
          <p className="strap">
            One fire record from two satellites. NASA MODIS and VIIRS hot spots, harmonized into a burning calendar for any place on Earth
            {meta ? `, ${dayToDate(meta.firstDay).getUTCFullYear()}–${dayToDate(meta.lastDay).getUTCFullYear()}` : ''}.
          </p>
        </header>

        {notice && <p className="notice" role="alert">{notice}</p>}

        {!area && (
          <div className="intro">
            <h1>When does it burn here?</h1>
            <p className="lede">
              Draw a box on the map, or open one of these places, to read its fire year: when burning normally starts, peaks and ends, which years broke the pattern, and whether this year is running hot.
            </p>
            <ol className="places">
              {PRESETS.map((p) => (
                <li key={p.id}>
                  <button onClick={() => select(p.bbox, p.name, true)}>
                    <span className="place-name">{p.name}</span>
                    <span className="place-where">{p.where}</span>
                    <span className="place-note">{p.note}</span>
                  </button>
                </li>
              ))}
            </ol>
            {meta && <Method meta={meta} series={null} />}
          </div>
        )}

        {area && !almanac && (
          <div className="loading">
            <h1>{area.name ?? 'Custom area'}</h1>
            <p className="kicker">{bboxLabel(area.bbox)}</p>
            <div className="bar-track"><div className="bar-fill" style={{ transform: `scaleX(${progress ? Math.max(0.06, progress[0] / Math.max(1, progress[1])) : 0.06})` }} /></div>
            <p className="lede">Reading 25 years of satellite passes…</p>
          </div>
        )}

        {area && almanac && meta && series && (
          <Report
            meta={meta}
            series={series}
            almanac={almanac}
            name={area.name}
            bbox={area.bbox}
            year={year}
            setYear={setYear}
            smooth={smooth}
            setSmooth={setSmooth}
            onClear={clear}
            onExport={exportCsv}
          />
        )}
      </aside>
    </div>
  )
}

function lead(a: Almanac): string[] {
  const out: string[] = []
  if (a.sparse || !a.season) {
    out.push(`Satellites rarely see fire here — about ${fmt(a.meanAnnual)} detections in a typical year, too few to define a season. The calendar below still shows every detection since 2000.`)
    return out
  }
  if (a.periods.length >= 2) {
    const ps = a.periods
    const parts = ps.map((p) => `${doyLabel(p.start)} to ${doyLabel(p.end)} (${Math.round(p.share * 100)}% of a normal year’s fire, peaking around ${doyLabel(p.peak)})`)
    const count = ps.length === 2 ? 'two' : ps.length === 3 ? 'three' : 'several'
    out.push(`Burning here comes in ${count} pulses a year: ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`)
    return out
  }
  const s = a.season
  const top = a.monthShare.map((v, i) => [v, i] as const).sort((x, y) => y[0] - x[0])
  const lo = Math.min(top[0][1], top[1][1])
  const hi = Math.max(top[0][1], top[1][1])
  const months = top[0][0] > 0.5 ? MONTH_LONG[top[0][1]] : lo === 0 && hi === 11 ? 'December and January' : `${MONTH_LONG[lo]} and ${MONTH_LONG[hi]}`
  const tight = s.length <= 75 ? 'a short, sharp season' : s.length <= 150 ? 'a well-defined season' : 'a long, drawn-out season'
  out.push(
    `Burning here is ${tight}: in a normal year 80% of it falls between ${doyLabel(s.start)} and ${doyLabel(s.end)} (${s.length} days), peaking around ${doyLabel(s.peak)}. ${months} ${top[0][0] > 0.5 ? 'alone carries' : 'together carry'} ${Math.round((top[0][0] > 0.5 ? top[0][0] : top[0][0] + top[1][0]) * 100)}% of the year’s fire.`,
  )
  return out
}

function Report(p: {
  meta: Meta
  series: Series
  almanac: Almanac
  name: string | null
  bbox: BBox
  year: number | null
  setYear: (y: number | null) => void
  smooth: boolean
  setSmooth: (b: boolean) => void
  onClear: () => void
  onExport: () => void
}) {
  const { almanac: a, meta, series } = p
  const [copied, setCopied] = useState(false)
  const complete = a.annual.filter((x) => x.complete)
  const ranked = [...complete].sort((x, y) => y.total - x.total)
  const selected = p.year !== null ? a.annual.find((x) => x.year === p.year) : null
  const rank = selected ? ranked.findIndex((x) => x.year === selected.year) + 1 : 0
  const l = a.latest
  const lastDate = dayToDate(meta.lastDay)
  return (
    <article className="report">
      <div className="report-head">
        <div>
          <p className="kicker">{bboxLabel(p.bbox)} · {fmt(areaKm2(p.bbox))} km²</p>
          <h1>{p.name ?? 'Custom area'}</h1>
        </div>
        <button className="ghost" onClick={p.onClear}>All places</button>
      </div>

      {lead(a).map((t, i) => <p key={i} className="lede">{t}</p>)}

      {!a.sparse && (
        <dl className="facts">
          <div>
            <dt>Typical year</dt>
            <dd>{fmt(a.meanAnnual)}</dd>
            <small>VIIRS-equivalent detections</small>
          </div>
          <div>
            <dt>Record year</dt>
            <dd>{ranked[0]?.year}</dd>
            <small>{ranked[0] ? `${(ranked[0].total / a.meanAnnual).toFixed(1)}× a typical year` : ''}</small>
          </div>
          <div>
            <dt>Since {a.fullYears[0]}</dt>
            <dd>{a.trend ? `${a.trend.slopePct >= 0 ? '+' : '−'}${Math.abs(a.trend.slopePct).toFixed(1)}%` : '–'}</dd>
            <small>{a.trend ? `per year · ${a.trend.p < 0.05 ? 'a significant trend' : 'not a clear trend'} (p ${a.trend.p < 0.001 ? '< 0.001' : a.trend.p < 0.01 ? `= ${a.trend.p.toFixed(3)}` : `= ${a.trend.p.toFixed(2)}`})` : ''}</small>
          </div>
          {l && l.normal > 0 && (
            <div>
              <dt>{l.year}{a.fullYears.includes(l.year) ? '' : ' so far'}</dt>
              <dd>{l.ratio >= 10 ? Math.round(l.ratio) : l.ratio.toFixed(1)}×</dd>
              <small>
                {a.fullYears.includes(l.year) ? 'a normal year' : `normal for 1 Jan–${MONTHS[lastDate.getUTCMonth()]} ${lastDate.getUTCDate()}`} · above {Math.round(l.percentile)}% of years
              </small>
            </div>
          )}
        </dl>
      )}

      <section>
        <div className="sec-head">
          <h2>Burning calendar</h2>
          <div className="seg small">
            <button aria-selected={p.smooth} onClick={() => p.setSmooth(true)}>7-day mean</button>
            <button aria-selected={!p.smooth} onClick={() => p.setSmooth(false)}>Daily</button>
          </div>
        </div>
        <p className="sec-note">Each row is a year, each mark a day. Darker means more fire. Click a year to inspect it.</p>
        <Calendar meta={meta} series={series} almanac={a} smooth={p.smooth} year={p.year} onYear={p.setYear} />
        <div className="scale">
          <span>no fire</span>
          <i className="scale-ramp" />
          <span>{fmt(a.scaleMax)}+ a day</span>
          {a.season && <span className="scale-season"><i /> {a.periods.length >= 2 ? 'normal burning periods' : 'normal fire season'}, ▼ peak</span>}
        </div>
      </section>

      {!a.sparse && (
        <section>
          <div className="sec-head">
            <h2>{p.year ?? 'A year'} against the normal year</h2>
            <select value={p.year ?? ''} onChange={(e) => p.setYear(e.target.value ? Number(e.target.value) : null)} aria-label="Year to compare">
              <option value="">No year</option>
              {[...a.years].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {selected && (
            <p className="sec-note">
              {selected.terraOnly
                ? `Only the Terra satellite was flying for ${selected.year === 2002 ? 'half of 2002' : selected.year}. It is drawn here but kept out of the statistics.`
                : selected.complete
                ? `${selected.year} ran ${Math.abs(selected.anomalyPct) < 8 ? 'close to normal' : `${Math.abs(Math.round(selected.anomalyPct))}% ${selected.anomalyPct > 0 ? 'above' : 'below'} normal`} — ${rank === 1 ? 'the most fire of any year' : `ranked ${rank} of ${complete.length} years`}.`
                : `${selected.year} is still in progress (data to ${shortDate(meta.lastDay)}).`}
              {selected.estimated > selected.total * 0.5 ? ' Estimated from MODIS.' : ''}
            </p>
          )}
          <SeasonChart almanac={a} year={p.year} />
        </section>
      )}

      {!a.sparse && (
        <section>
          <div className="sec-head"><h2>Year by year</h2></div>
          <p className="sec-note">
            Before 2012 only MODIS was flying. Its raw count (dotted) sits far below what VIIRS sees; the hatched bars are that same record lifted to VIIRS terms
            {Number.isFinite(series.meanRatio) ? ` — here, one MODIS detection stands for ${series.meanRatio.toFixed(1)} VIIRS detections on average` : ''}.
          </p>
          <AnnualChart almanac={a} year={p.year} onYear={p.setYear} />
        </section>
      )}

      {a.episodes.length > 0 && (
        <section>
          <div className="sec-head"><h2>When the pattern broke</h2></div>
          <p className="sec-note">Runs of five days or more above the 90th percentile for that time of year, largest first. Searched from July 2002, when both MODIS instruments were flying.</p>
          <ol className="episodes">
            {a.episodes.slice(0, 8).map((e: Episode) => (
              <li key={e.startDay}>
                <button onClick={() => p.setYear(e.year)} className={e.year === p.year ? 'on' : ''}>
                  <span className="ep-date">{shortDate(e.startDay)} – {shortDate(e.endDay)}, <b>{e.year}</b></span>
                  <span className="ep-bar"><i style={{ transform: `scaleX(${Math.min(1, e.score / a.episodes[0].score)})` }} /></span>
                  <span className="ep-x">{e.ratio >= 20 ? '20×+' : `${e.ratio.toFixed(1)}×`} <small>normal</small></span>
                  <span className="ep-tag">{e.offSeason ? 'out of season' : e.endDay < meta.viirsStartDay ? 'MODIS era' : ''}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Method meta={meta} series={series} />

      <footer className="report-foot">
        <button className="ghost" onClick={p.onExport}>Download daily record (CSV)</button>
        <button
          className="ghost"
          onClick={() => navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) })}
        >
          {copied ? 'Link copied' : 'Copy link to this area'}
        </button>
      </footer>
    </article>
  )
}
