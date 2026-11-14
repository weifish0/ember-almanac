import { useEffect, useRef } from 'react'
import maplibregl, { type CanvasSource, type ExpressionSpecification, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import { decodeClim, snapBBox, type BBox, type Clim, type Meta } from '../lib/data'
import { GLOW, MONTH_COLORS } from '../lib/color'

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best'
const LAT_N = 78
const LAT_S = -58
const CW = 2880 // two pixels per 0.25 degree cell
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const CH = Math.round((CW * (mercY(LAT_N) - mercY(LAT_S))) / (2 * Math.PI))

const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']]

const style: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  projection: { type: 'globe' },
  sources: {
    base: {
      type: 'raster',
      tiles: [`${GIBS}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
      tileSize: 256,
      maxzoom: 8,
      attribution: 'Fire data: NASA FIRMS (MODIS C6.1, VIIRS S-NPP 375 m) · Imagery: NASA GIBS Blue Marble',
    },
    lines: { type: 'geojson', data: `${import.meta.env.BASE_URL}lines.json` },
    places: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution: 'Labels © <a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Borders: Natural Earth',
    },
    aoi: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#14100e' } },
    {
      id: 'base',
      type: 'raster',
      source: 'base',
      paint: { 'raster-saturation': -0.8, 'raster-brightness-max': 0.44, 'raster-contrast': 0.2, 'raster-fade-duration': 150 },
    },
    { id: 'coast', type: 'line', source: 'lines', filter: ['==', ['get', 'k'], 'c'], paint: { 'line-color': '#b8a68e', 'line-width': 0.6, 'line-opacity': 0.5 } },
    { id: 'lines', type: 'line', source: 'lines', filter: ['==', ['get', 'k'], 'b'], paint: { 'line-color': '#e6d8c0', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1.1], 'line-opacity': 0.55 } },
    {
      id: 'label-country', type: 'symbol', source: 'places', 'source-layer': 'place', maxzoom: 6.5,
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': NAME, 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.12,
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 5, 12.5], 'text-max-width': 7,
      },
      paint: { 'text-color': '#e9dcc6', 'text-opacity': 0.82, 'text-halo-color': 'rgba(20,16,14,0.85)', 'text-halo-width': 1.3 },
    },
    {
      id: 'label-state', type: 'symbol', source: 'places', 'source-layer': 'place', minzoom: 4.2, maxzoom: 9,
      filter: ['==', ['get', 'class'], 'state'],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-size': 10, 'text-max-width': 7 },
      paint: { 'text-color': '#cdbfa8', 'text-opacity': 0.7, 'text-halo-color': 'rgba(20,16,14,0.8)', 'text-halo-width': 1.1 },
    },
    {
      id: 'label-city', type: 'symbol', source: 'places', 'source-layer': 'place', minzoom: 3.6,
      filter: ['all', ['==', ['get', 'class'], 'city'], ['<=', ['get', 'rank'], ['step', ['zoom'], 3, 5, 6, 6.5, 12]]],
      layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10.5, 8, 13], 'text-max-width': 8 },
      paint: { 'text-color': '#f4ecdc', 'text-opacity': 0.9, 'text-halo-color': 'rgba(20,16,14,0.9)', 'text-halo-width': 1.2 },
    },
    { id: 'aoi-fill', type: 'fill', source: 'aoi', paint: { 'fill-color': '#f4ecdc', 'fill-opacity': 0.07 } },
    { id: 'aoi-halo', type: 'line', source: 'aoi', paint: { 'line-color': '#14100e', 'line-width': 4, 'line-opacity': 0.55 } },
    { id: 'aoi-line', type: 'line', source: 'aoi', paint: { 'line-color': '#f4ecdc', 'line-width': 1.6 } },
  ],
  sky: { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.6, 5, 0] },
}

const rect = (b: BBox): FeatureCollection => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]],
      },
    },
  ],
})

export type MapMode = 'month' | 'peak'
type Props = {
  meta: Meta
  clim: Clim | null
  month: number
  mode: MapMode
  bbox: BBox | null
  drawing: boolean
  focus: { bbox: BBox; nonce: number } | null
  onBBox: (b: BBox) => void
  onHover?: (info: { lng: number; lat: number; value: number; peak: number } | null) => void
}

export function MapView({ meta, clim, month, mode, bbox, drawing, focus, onBBox, onHover }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const geom = useRef<{ x: Uint16Array; y0: Uint16Array; y1: Uint16Array; peak: Uint8Array; annual: Float32Array; lookup: Map<number, number> } | null>(null)
  const paintToken = useRef(0)
  const drawingRef = useRef(drawing)
  const cb = useRef({ onBBox, onHover })
  cb.current = { onBBox, onHover }
  drawingRef.current = drawing

  // --- create the map once
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = CW
    canvas.height = CH
    canvasRef.current = canvas
    const map = new maplibregl.Map({
      container: el.current!,
      style,
      center: [100, 16],
      zoom: 2.4,
      minZoom: 1,
      maxZoom: 8.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      boxZoom: false,
    })
    map.touchZoomRotate.disableRotation()
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')
    // keep the attribution collapsed to its (i) button so it never covers the legend
    const collapse = () => {
      const a = el.current?.querySelector('.maplibregl-ctrl-attrib')
      a?.classList.remove('maplibregl-compact-show')
      a?.removeAttribute('open')
    }
    map.once('styledata', collapse)
    map.once('load', collapse)
    mapRef.current = map
    // handle for scripted screenshots (video/scripts/capture.mjs)
    ;(window as unknown as Record<string, unknown>).__emberMap = map
    // Add the fire layer as soon as the style itself is parsed - don't wait for every basemap tile.
    const addFire = () => {
      if (!map.getStyle() || map.getSource('fire')) return
      map.addSource('fire', {
        type: 'canvas',
        canvas,
        animate: false,
        coordinates: [[-180, LAT_N], [180, LAT_N], [180, LAT_S], [-180, LAT_S]],
      })
      map.addLayer({ id: 'fire', type: 'raster', source: 'fire', paint: { 'raster-resampling': 'nearest', 'raster-fade-duration': 0, 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.94, 6.5, 0.72] } }, 'coast')
      map.off('styledata', addFire)
      map.fire('fire-ready')
    }
    map.on('styledata', addFire)
    addFire()

    // rectangle drawing (button, or shift + drag)
    let start: maplibregl.LngLat | null = null
    const src = () => map.getSource('aoi') as GeoJSONSource | undefined
    const box = (a: maplibregl.LngLat, b: maplibregl.LngLat): BBox => [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)]
    const down = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const shift = 'shiftKey' in e.originalEvent && e.originalEvent.shiftKey
      if (!drawingRef.current && !shift) return
      e.preventDefault()
      map.dragPan.disable()
      start = e.lngLat
    }
    const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (start) src()?.setData(rect(snapBBox(box(start, e.lngLat))))
    }
    const up = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!start) return
      const b = box(start, e.lngLat)
      start = null
      map.dragPan.enable()
      if (b[2] - b[0] > 0.05 && b[3] - b[1] > 0.05) cb.current.onBBox(snapBBox(b))
    }
    map.on('mousedown', down)
    map.on('mousemove', move)
    map.on('mouseup', up)
    map.on('touchstart', down)
    map.on('touchmove', move)
    map.on('touchend', up)

    map.on('mousemove', (e) => {
      const g = geom.current
      if (!g || !cb.current.onHover) return
      const ix = Math.floor((e.lngLat.lng + 180) / 0.25)
      const iy = Math.floor((e.lngLat.lat + 90) / 0.25)
      const i = g.lookup.get(iy * 1440 + ix)
      cb.current.onHover(i === undefined ? null : { lng: e.lngLat.lng, lat: e.lngLat.lat, value: i, peak: g.peak[i] })
    })
    map.on('mouseout', () => cb.current.onHover?.(null))
    return () => map.remove()
  }, [])

  // --- per-cell pixel geometry + peak month, once the climatology arrives
  useEffect(() => {
    if (!clim) return
    const n = clim.cells.length
    const x = new Uint16Array(n)
    const y0 = new Uint16Array(n)
    const y1 = new Uint16Array(n)
    const peak = new Uint8Array(n)
    const annual = new Float32Array(n)
    const lookup = new Map<number, number>()
    const top = mercY(LAT_N)
    const span = top - mercY(LAT_S)
    const row = (lat: number) => Math.round(((top - mercY(Math.max(LAT_S, Math.min(LAT_N, lat)))) / span) * CH)
    for (let i = 0; i < n; i++) {
      const c = clim.cells[i]
      const ix = c % meta.nx
      const iy = Math.floor(c / meta.nx)
      const lat = iy * meta.res - 90
      x[i] = ix * 2
      y0[i] = row(lat + meta.res)
      y1[i] = row(lat)
      let best = 0
      let sum = 0
      for (let m = 0; m < 12; m++) {
        const q = clim.q[i * 12 + m]
        sum += decodeClim(q) * 30.4
        if (q > clim.q[i * 12 + best]) best = m
      }
      peak[i] = best
      annual[i] = sum
      lookup.set(c, i)
    }
    geom.current = { x, y0, y1, peak, annual, lookup }
  }, [clim, meta])

  // --- paint the fire layer
  useEffect(() => {
    const map = mapRef.current
    const canvas = canvasRef.current
    const g = geom.current
    if (!map || !canvas || !clim || !g) return
    const token = ++paintToken.current
    const paint = () => {
      const ctx = canvas.getContext('2d')!
      const img = ctx.createImageData(CW, CH)
      const px = new Uint32Array(img.data.buffer)
      const lut = new Uint32Array(256)
      for (let i = 0; i < 256; i++) lut[i] = (GLOW[i * 4 + 3] << 24) | (GLOW[i * 4 + 2] << 16) | (GLOW[i * 4 + 1] << 8) | GLOW[i * 4]
      const n = clim.cells.length
      for (let i = 0; i < n; i++) {
        let color: number
        if (mode === 'month') {
          const q = clim.q[i * 12 + month]
          if (q < 6) continue
          // q is log-coded; stretch 0.01 .. 60 detections/day over the ramp
          color = lut[Math.min(255, Math.round((q - 6) * 1.28))]
        } else {
          const a = g.annual[i]
          if (a < 2) continue
          const [r, gg, b] = MONTH_COLORS[g.peak[i]]
          const alpha = Math.min(255, Math.round(70 + 185 * Math.min(1, Math.log10(a / 2) / 2.2)))
          color = (alpha << 24) | (b << 16) | (gg << 8) | r
        }
        const xs = g.x[i]
        for (let y = g.y0[i]; y < g.y1[i]; y++) {
          const o = y * CW + xs
          px[o] = color
          px[o + 1] = color
        }
      }
      ctx.putImageData(img, 0, 0)
      const s = map.getSource('fire') as CanvasSource | undefined
      if (s) {
        // a static canvas source only re-uploads its texture while "playing": keep it playing for a few frames
        s.play()
        let frames = 0
        const stop = () => {
          if (++frames < 4) return
          map.off('render', stop)
          if (token === paintToken.current) s.pause()
        }
        map.on('render', stop)
        map.triggerRepaint()
      }
    }
    if (map.getSource('fire')) paint()
    else map.once('fire-ready', paint)
  }, [clim, month, mode])

  // --- area of interest outline
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const set = () => (map.getSource('aoi') as GeoJSONSource | undefined)?.setData(bbox ? rect(bbox) : { type: 'FeatureCollection', features: [] })
    if (map.getStyle() && map.getSource('aoi')) set()
    else map.once('styledata', set)
  }, [bbox])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus) return
    const b = focus.bbox
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 90, duration: 1600, maxZoom: 6.2 })
  }, [focus])

  useEffect(() => {
    const map = mapRef.current
    if (map) map.getCanvas().style.cursor = drawing ? 'crosshair' : ''
  }, [drawing])

  return <div ref={el} className="map" />
}
