import * as maplibregl from 'maplibre-gl'
import type {
  ExpressionSpecification,
  GeoJSONSource,
  ImageSource,
  LngLatBoundsLike,
  Map as MLMap,
  MapMouseEvent,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 parses tiles in an ES-module web worker; let Vite bundle it and tell MapLibre where it ends up
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CellCollection, CellFeature, DriftResponse, GearCollection, GearProps, ParticlePath } from '../api'
import { REPORT_COLOR, STRANDED_COLOR, beachingRGBA, beachingRange, driftRGBA, ringCenter, windageColor } from '../format'
import type { Report } from '../game/rules'
import type { Stranding } from '../staticData'
import { GEAR_ICON_TYPES, gearIconImages } from '../gearIcons'
import { BASEMAP_URL, MAP_COLORS as C, simplifyBasemap } from '../mapStyle'
import { type Raster, buildRaster } from '../raster'

export interface Layers {
  gear: boolean
  beaching: boolean
  paths: boolean
  drift: boolean
  reports: boolean // the user's own found-gear reports ("Mine funn")
}

/** 'region' = all items' expected nets; 'item' = one selected item's own chance of washing ashore. */
export type BeachingMode = 'region' | 'item'

/** What the user tapped on the map; shown as a card in the bottom sheet instead of a map popup. */
export type Picked =
  | { kind: 'gear'; gear: GearProps }
  | { kind: 'cell'; cell: CellFeature }
  | { kind: 'report'; report: Report }

interface Props {
  bbox: [number, number, number, number]
  attribution: string
  gear: GearCollection | null
  cells: CellCollection | null
  /** Playback: the previous day's cells, cross-faded into `cells` by `blend` (0 = all previous, 1 = all current). */
  prevCells?: CellCollection | null
  blend?: number
  breaks: number[]
  drift: DriftResponse | null
  paths: ParticlePath[] | null
  reports: Report[] // shown as "Mine funn" (deliveries and rejected reports are left out)
  windageFactors: number[]
  selectedNets: string[]
  picked: Picked | null
  layers: Layers
  focus: [number, number] | null
  userPos: [number, number] | null // shown as a 'you are here' dot once known
  startPos?: [number, number] | null // the user's position at start: the map opens there instead of on the region
  /** Playback time (epoch ms): paths grow up to it with a moving head, strandings pop up as they happen. */
  time?: number | null
  /** Playback: every particle stranding in the region, sorted by time. With these the beaching map is drawn live. */
  strandings?: Stranding[] | null
  /** Days in a beaching window (index.json beaching_window_days). */
  windowDays?: number
  /** How long one playback step takes (ms); fades between steps over this time so playback looks continuous. */
  stepMs?: number
  onMapReady: (map: MLMap) => void // lets the Home button fly back to the region
  onPick: (picked: Picked | null) => void
}

maplibregl.setWorkerUrl(maplibreWorkerUrl)

// How far (px) from a dot a finger tap still selects it. Small dots need a generous area.
const TAP_RADIUS = 22
// A tap this close (px) to a lost-gear dot means the user is on it, even inside a large 1 km cell.
const GEAR_DIRECT_HIT = 9
// Lost gear closer than this (px) on screen merges into a cluster with a count; tapping it zooms in until it splits.
// From GEAR_CLUSTER_MAX_ZOOM on every item is shown on its own.
const GEAR_CLUSTER_RADIUS = 12 // about an icon's radius: only (almost) fully overlapping icons merge
const GEAR_CLUSTER_MAX_ZOOM = 13

// Smoothing radius (in grid cells) of the interpolated rasters: higher = rounder and softer, 0 = plain bilinear.
// Same values as the desktop map (frontend/src/components/Map.tsx).
const BEACHING_SMOOTH_CELLS = 0.7
const DRIFT_SMOOTH_CELLS = 0.8

// Stranded particles are drawn as 100 m squares at true size (at least 2 px); particles that strand at (almost)
// the same spot share one square so they don't pile up into blobs.
const STRANDED_SQUARE_M = 100
const MIN_SQUARE_PX = 2
// Playback: a stranding stays visible this long after it happens, fading out.
const SPARK_MS = 4 * 3600_000 // short, so the strandings flash up and the beaching map underneath stays visible
const SPARK_PX = 4
// Playback with every stranding loaded: the beaching map is a GPU heat map of the strandings in the window up to the
// clock, recomputed every step (a raster rebuild takes ~0.5 s, far too slow per step). Each stranding counts with its
// weight over about LIVE_RADIUS_M, roughly the 1 km cells smoothed like the raster, on the same colour scale.
const LIVE_RADIUS_M = 1500
// zoomed far out that is a few px, and MapLibre draws heat maps at reduced resolution: blocky. Below this radius the
// kernel stays this size and the intensity drops with its area instead, so the colours keep their meaning.
const LIVE_MIN_RADIUS_PX = 7
const DAY_MS = 86_400_000
const HEATMAP_PEAK = 0.3989 // MapLibre's heat map kernel peak (1/sqrt(2 pi)): one point at weight w gives w * 0.4

// Item zooms: MapLibre counts zoom with 512 px tiles, one level below Leaflet's 256 px tiles for the same scale.
const FOCUS_ZOOM = 10
const START_ZOOM = 8 // opening view around the user: roughly 60 km across on a phone
const FIT_MAX_ZOOM = 11
const FLY_MS = 800
const MIN_FIT_PX = 100 // a container smaller than this hasn't been laid out yet
const SHEET_SETTLE_MS = 320 // the bottom sheet's open/close transition (300 ms) plus a frame

const SQUARE_ICON = 'stranded-square'
const ICON_PX = 32 // logical size of the square icon; icon-size scales it
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

// Overlay sources and layers, bottom to top: beaching (yesterday, today) < drift heat < paths < stranding squares
// < playback strandings < moving path heads < lost gear < you-are-here.
const RASTERS = ['beach-prev', 'beach-cur', 'drift-heat'] as const
type RasterId = (typeof RASTERS)[number]

/** Size [dlon, dlat] of a cell from its polygon ring. */
function ringSize(ring: number[][]): [number, number] {
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats)]
}

// Rasters are slow-ish to build (smoothing a whole region), so each cell collection is built once and reused,
// e.g. when playback returns to a day or cross-fades two days.
const rasterCache = new WeakMap<object, Raster | null>()

function beachingRaster(cells: CellCollection, breaks: number[]): Raster | null {
  const hit = rasterCache.get(cells)
  if (hit !== undefined) return hit
  const feats = cells.features
  const raster =
    feats.length === 0
      ? null
      : buildRaster(
          feats.map((f) => {
            const [lat, lon] = ringCenter(f.geometry.coordinates[0])
            return { lat, lon, v: f.properties.expected_nets }
          }),
          ringSize(feats[0].geometry.coordinates[0]),
          (v) => beachingRGBA(v, breaks),
          { smoothCells: BEACHING_SMOOTH_CELLS },
        )
  rasterCache.set(cells, raster)
  return raster
}

function driftRaster(drift: DriftResponse): Raster | null {
  const hit = rasterCache.get(drift)
  if (hit !== undefined) return hit
  const raster = buildRaster(drift.cells.map(([lat, lon, v]) => ({ lat, lon, v })), drift.cell_deg, driftRGBA, {
    smoothCells: DRIFT_SMOOTH_CELLS,
  })
  rasterCache.set(drift, raster)
  return raster
}

const corners = ([[s, w], [n, e]]: Raster['bounds']): [[number, number], [number, number], [number, number], [number, number]] => [
  [w, n],
  [e, n],
  [e, s],
  [w, s],
]

/** The red square used for stranded particles: drawn once into the map's sprite. */
function squareImage(): ImageData {
  const px = ICON_PX * 2 // 2x for sharp edges on retina screens
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = px
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = STRANDED_COLOR
  ctx.fillRect(3, 3, px - 6, px - 6)
  return ctx.getImageData(0, 0, px, px)
}

/** icon-size that draws the square at its true 100 m (never below MIN_SQUARE_PX) at latitude `lat`. */
function trueSizeIcon(lat: number) {
  const metersPerPxZ0 = (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / 512
  const sizeAt = (z: number) => STRANDED_SQUARE_M / (metersPerPxZ0 / 2 ** z) / ICON_PX
  const minSize = MIN_SQUARE_PX / ICON_PX
  const zMin = Math.log2((MIN_SQUARE_PX * metersPerPxZ0) / STRANDED_SQUARE_M) // where the true size reaches the minimum
  return ['interpolate', ['exponential', 2], ['zoom'], 0, minSize, Math.max(zMin, 0.01), minSize, 24, sizeAt(24)]
}

/** Heat map paint matching the beaching raster: colours from beachingRGBA (log scale), radius a fixed ground size. */
function liveHeatmapPaint(breaks: number[], lat: number) {
  const [lo, hi] = beachingRange(breaks)
  // heatmap-density runs 0..1 = 0..hi expected nets; heatmap-color interpolates linearly, so sample the log scale
  const stops: (number | string)[] = [0, 'rgba(0,0,0,0)']
  const N = 14
  for (let k = 0; k <= N; k++) {
    const v = lo * 0.25 * (hi / (lo * 0.25)) ** (k / N)
    const [r, g, b, a] = beachingRGBA(v, breaks)
    stops.push(v / hi, `rgba(${r},${g},${b},${a.toFixed(3)})`)
  }
  const metersPerPxZ0 = (2 * Math.PI * 6378137 * Math.cos((lat * Math.PI) / 180)) / 512
  const r0 = LIVE_RADIUS_M / metersPerPxZ0 // true radius at zoom 0 (doubles per zoom level)
  const zMin = Math.min(Math.max(Math.log2(LIVE_MIN_RADIUS_PX / r0), 0.01), 11) // where it reaches the minimum
  const intensity = 1 / (hi * HEATMAP_PEAK)
  return {
    'heatmap-weight': ['get', 'w'] as ExpressionSpecification,
    'heatmap-intensity': ['interpolate', ['exponential', 4], ['zoom'], 0, intensity * 4 ** -zMin, zMin, intensity, 22, intensity] as ExpressionSpecification,
    'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 0, LIVE_MIN_RADIUS_PX, zMin, LIVE_MIN_RADIUS_PX, 12, r0 * 4096, 22, r0 * 4096] as ExpressionSpecification,
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...stops] as unknown as ExpressionSpecification,
  }
}

/** Adds the overlay sources and layers (again after a basemap style change, which removes them). */
function addOverlays(map: MLMap, bbox: Props['bbox']) {
  const [w, s, e, n] = bbox
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id // rasters go under the place names
  simplifyBasemap(map)
  if (!map.hasImage(SQUARE_ICON)) map.addImage(SQUARE_ICON, squareImage(), { pixelRatio: 2 })
  for (const { name, image, pixelRatio } of gearIconImages()) if (!map.hasImage(name)) map.addImage(name, image, { pixelRatio })
  for (const id of RASTERS) {
    map.addSource(id, {
      type: 'image',
      url: BLANK_PNG,
      coordinates: [
        [w, n],
        [e, n],
        [e, s],
        [w, s],
      ],
    })
    map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        layout: { visibility: 'none' },
        paint: {
          'raster-fade-duration': 0,
          'raster-resampling': 'linear',
          'raster-opacity': 1,
        },
      },
      firstLabel,
    )
  }
  for (const id of ['beach-live', 'paths', 'strand', 'sparks', 'heads', 'gear-sel', 'reports', 'user']) map.addSource(id, { type: 'geojson', data: EMPTY })
  // the selected items stay out of the clusters (gear-sel), so they are always visible
  map.addSource('gear', {
    type: 'geojson',
    data: EMPTY,
    cluster: true,
    clusterRadius: GEAR_CLUSTER_RADIUS,
    clusterMaxZoom: GEAR_CLUSTER_MAX_ZOOM,
  })
  map.addLayer({ id: 'beach-live', type: 'heatmap', source: 'beach-live', layout: { visibility: 'none' } }, firstLabel)
  map.addLayer({
    id: 'paths',
    type: 'line',
    source: 'paths',
    layout: { 'line-join': 'round', 'line-cap': 'round', 'line-sort-key': ['-', 0, ['get', 'wdf']] }, // low windage on top
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.75 },
  })
  map.addLayer({
    id: 'strand',
    type: 'symbol',
    source: 'strand',
    layout: {
      'icon-image': SQUARE_ICON,
      'icon-size': trueSizeIcon((s + n) / 2) as never,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': 0.95 },
  })
  map.addLayer({
    id: 'sparks',
    type: 'symbol',
    source: 'sparks',
    layout: {
      'icon-image': SQUARE_ICON,
      'icon-size': SPARK_PX / ICON_PX,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': ['get', 'opacity'] },
  })
  map.addLayer({
    id: 'heads',
    type: 'circle',
    source: 'heads',
    paint: {
      'circle-radius': 3.5,
      'circle-color': ['get', 'color'],
      'circle-stroke-color': C.headStroke,
      'circle-stroke-width': 1,
    },
  })
  // lost gear: an icon per gear type (gearIcons.ts), small when zoomed out so the whole coast stays readable, the
  // selected ones bigger, violet and on top. Taps don't depend on the size (a fixed tap radius is used).
  const sel: ExpressionSpecification = ['get', 'sel']
  const type: ExpressionSpecification = ['match', ['get', 'type'], GEAR_ICON_TYPES, ['get', 'type'], 'generic']
  const gearLayout = {
    'icon-image': ['concat', 'gear-', type, ['case', sel, '-sel', '']] as ExpressionSpecification,
    'icon-size': ['interpolate', ['linear'], ['zoom'], 6, ['case', sel, 1.1, 0.7], 9, ['case', sel, 1.25, 0.9], 12, ['case', sel, 1.35, 1]] as ExpressionSpecification,
    'icon-allow-overlap': true,
    'icon-ignore-placement': true,
  }
  // clusters: a dark badge with the number of items, bigger for more
  const count: ExpressionSpecification = ['get', 'point_count']
  map.addLayer({
    id: 'gear-clusters',
    type: 'circle',
    source: 'gear',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': C.gearFill,
      'circle-radius': ['step', count, 10, 10, 11.5, 40, 13.5],
      'circle-stroke-color': C.gearStroke,
      'circle-stroke-width': 2,
      'circle-opacity': 0.95,
    },
  })
  map.addLayer({
    id: 'gear-count',
    type: 'symbol',
    source: 'gear',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['step', count, 10.5, 10, 11, 40, 12],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffffff' },
  })
  map.addLayer({ id: 'gear', type: 'symbol', source: 'gear', filter: ['!', ['has', 'point_count']], layout: gearLayout })
  map.addLayer({ id: 'gear-sel', type: 'symbol', source: 'gear-sel', layout: gearLayout })
  // the user's own reports: teal dots, fainter while waiting for approval
  const pending: ExpressionSpecification = ['==', ['get', 'status'], 'pending']
  map.addLayer({
    id: 'reports',
    type: 'circle',
    source: 'reports',
    paint: {
      'circle-radius': ['case', ['get', 'sel'], 8, 6],
      'circle-color': REPORT_COLOR,
      'circle-opacity': ['case', pending, 0.6, 0.95],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', pending, 1.5, 2],
      'circle-stroke-opacity': ['case', pending, 0.7, 1],
    },
  })
  map.addLayer({
    id: 'user',
    type: 'circle',
    source: 'user',
    paint: { 'circle-radius': 8, 'circle-color': C.userFill, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
  })
}

function geo(map: MLMap, id: string): GeoJSONSource | undefined {
  return map.getSource(id) as GeoJSONSource | undefined
}

/** Shows `raster` on an image layer (or hides the layer), fading its opacity to `opacity` over `fadeMs`. */
function showRaster(map: MLMap, id: RasterId, raster: Raster | null, opacity: number, fadeMs: number) {
  const source = map.getSource(id) as ImageSource | undefined
  if (!source) return
  if (!raster) {
    map.setLayoutProperty(id, 'visibility', 'none')
    return
  }
  const shown = (source as unknown as { _shownUrl?: string })._shownUrl
  if (shown !== raster.url) {
    source.updateImage({ url: raster.url, coordinates: corners(raster.bounds) })
    ;(source as unknown as { _shownUrl?: string })._shownUrl = raster.url
  }
  map.setLayoutProperty(id, 'visibility', 'visible')
  map.setPaintProperty(id, 'raster-opacity-transition', { duration: fadeMs, delay: 0 })
  map.setPaintProperty(id, 'raster-opacity', opacity)
}

/** Index of the last time <= t (binary search); -1 if t is before the first. */
function lastAtOrBefore(times: number[], t: number): number {
  let lo = 0
  let hi = times.length - 1
  if (t < times[0]) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Particle paths as map features, cut at playback time `t` (null = the whole path). */
function pathFeatures(paths: ParticlePath[], factors: number[], t: number | null) {
  const lines: Feature<LineString>[] = []
  const heads: Feature<Point>[] = []
  const spots = new Map<string, Feature<Point>>()
  for (const p of paths) {
    const color = windageColor(p.wdf, factors)
    let coords = p.coords.map(([lat, lon]) => [lon, lat])
    let ended = true
    if (t !== null && p.times && p.times.length === p.coords.length) {
      const k = lastAtOrBefore(p.times, t)
      if (k < 0) continue
      ended = k === coords.length - 1
      coords = coords.slice(0, k + 1)
      if (!ended) {
        // move smoothly between output steps
        const f = (t - p.times[k]) / (p.times[k + 1] - p.times[k])
        const [a, b] = [p.coords[k], p.coords[k + 1]]
        const head = [a[1] + (b[1] - a[1]) * f, a[0] + (b[0] - a[0]) * f]
        coords.push(head)
        heads.push({ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: head } })
      }
    }
    if (coords.length >= 2)
      lines.push({ type: 'Feature', properties: { color, wdf: p.wdf }, geometry: { type: 'LineString', coordinates: coords } })
    if (p.stranded && ended) {
      const [lon, lat] = coords[coords.length - 1]
      const key = `${Math.round(lat / 0.0009)},${Math.round(lon / 0.0017)}` // ~100 m grid at 58-70 N
      if (!spots.has(key)) spots.set(key, { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } })
    }
  }
  const fc = <T extends LineString | Point>(features: Feature<T>[]): FeatureCollection<T> => ({ type: 'FeatureCollection', features })
  return { lines: fc(lines), heads: fc(heads), spots: fc([...spots.values()]) }
}

/** Playback: strandings of the last SPARK_MS before `t`, fading out with age. */
function sparkFeatures(strandings: Stranding[], times: number[], t: number): FeatureCollection<Point> {
  const features: Feature<Point>[] = []
  // strandings are sorted by time: walk back from t until they are too old
  let k = lastAtOrBefore(times, t)
  for (; k >= 0 && t - strandings[k][2] <= SPARK_MS; k--) {
    const [lon, lat, at] = strandings[k]
    features.push({
      type: 'Feature',
      properties: { opacity: 0.85 * (1 - (t - at) / SPARK_MS) },
      geometry: { type: 'Point', coordinates: [lon, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

function pickedAt(picked: Picked | null, gear: GearCollection | null): [number, number] | null {
  if (picked?.kind === 'cell') return ringCenter(picked.cell.geometry.coordinates[0])
  if (picked?.kind === 'report') return [picked.report.pos.lat, picked.report.pos.lng]
  if (picked?.kind === 'gear') {
    const f = gear?.features.find((g) => g.properties.id === picked.gear.id)
    if (f) return [f.geometry.coordinates[1], f.geometry.coordinates[0]]
  }
  return null
}

/** A container smaller than MIN_FIT_PX hasn't been laid out yet. */
const tooSmall = (el: HTMLElement) => el.clientWidth < MIN_FIT_PX || el.clientHeight < MIN_FIT_PX

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Memoised: the bottom sheet re-renders App on every drag frame, which must not re-render the map. */
export default memo(function MapView(props: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [map, setMap] = useState<MLMap | null>(null)
  const [styleGen, setStyleGen] = useState(0) // bumps whenever the overlays have (re)been added to a fresh style
  const latest = useRef(props)
  useLayoutEffect(() => {
    latest.current = props
  })
  const time = props.time ?? null
  const stepMs = props.stepMs ?? 0

  const unfitted = useRef(false) // the map hasn't been placed yet because its container had no size

  // create the map once
  useEffect(() => {
    if (!container.current) return
    const [w, s, e, n] = latest.current.bbox
    const m = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_URL,
      bounds: [
        [w, s],
        [e, n],
      ],
      fitBoundsOptions: { padding: 8 },
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
    })
    m.touchZoomRotate.disableRotation()
    m.keyboard.disableRotation()
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    // the data credits must stay visible (not folded behind an "i" button on small screens)
    m.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: latest.current.attribution }), 'bottom-right')
    mapRef.current = m
    setMap(m)
    latest.current.onMapReady(m)
    // the bottom sheet grows and shrinks; MapLibre only tracks window resizes, so watch the container too.
    // A map created in a hidden or not-yet-laid-out container (e.g. an editor preview pane) fits the region into
    // 0x0 px and ends up showing half of Europe: fit again once the container first gets a real size.
    const el = container.current
    unfitted.current = tooSmall(el)
    const ro = new ResizeObserver(() => {
      m.resize()
      if (!unfitted.current || tooSmall(el)) return
      unfitted.current = false
      const start = latest.current.startPos
      if (start) m.jumpTo({ center: [start[1], start[0]], zoom: START_ZOOM })
      else
        m.fitBounds(
          [
            [w, s],
            [e, n],
          ],
          { padding: 8, duration: 0 },
        )
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      m.remove()
      mapRef.current = null
    }
  }, [])

  // add the overlays once the basemap style has loaded
  useEffect(() => {
    if (!map) return
    const onStyle = () => {
      addOverlays(map, latest.current.bbox)
      setStyleGen((g) => g + 1)
    }
    map.on('style.load', onStyle)
    if (map.isStyleLoaded() && !map.getSource('paths')) onStyle() // the style beat this effect to it
    return () => {
      map.off('style.load', onStyle)
    }
  }, [map])

  // taps: pick whatever is nearest (a gear dot or a coast cell), or nothing (closes the card)
  useEffect(() => {
    if (!map) return
    const onClick = (e: MapMouseEvent) => {
      const { gear, cells, reports, layers, onPick } = latest.current
      const { x, y } = e.point
      const box: [[number, number], [number, number]] = [
        [x - TAP_RADIUS, y - TAP_RADIUS],
        [x + TAP_RADIUS, y + TAP_RADIUS],
      ]
      // a cluster: zoom in until it splits up (no card)
      const clusters = layers.gear ? map.queryRenderedFeatures(box, { layers: ['gear-clusters'] }) : []
      const cluster = clusters
        .map((f) => ({ f, at: (f.geometry as Point).coordinates as [number, number] }))
        .sort((a, b) => {
          const [pa, pb] = [map.project(a.at), map.project(b.at)]
          return Math.hypot(pa.x - x, pa.y - y) - Math.hypot(pb.x - x, pb.y - y)
        })[0]
      if (cluster) {
        const source = map.getSource('gear') as GeoJSONSource
        void source.getClusterExpansionZoom(cluster.f.properties.cluster_id as number).then((zoom) => {
          map.easeTo({ center: cluster.at, zoom: Math.min(zoom + 0.5, GEAR_CLUSTER_MAX_ZOOM + 1), duration: reducedMotion() ? 0 : 500 })
        })
        onPick(null)
        return
      }
      const dist = (lat: number, lng: number) => {
        const p = map.project([lng, lat])
        return Math.hypot(p.x - e.point.x, p.y - e.point.y)
      }
      let bestD = TAP_RADIUS
      let best: Picked | null = null
      const consider = (d: number, picked: Picked) => {
        if (d <= bestD) [bestD, best] = [d, picked]
      }
      const { lng, lat } = e.lngLat
      if (layers.beaching && cells) {
        for (const cell of cells.features) {
          const ring = cell.geometry.coordinates[0]
          const [clat, clng] = ringCenter(ring)
          const lons = ring.map((p) => p[0])
          const lats = ring.map((p) => p[1])
          const inside = lng >= Math.min(...lons) && lng <= Math.max(...lons) && lat >= Math.min(...lats) && lat <= Math.max(...lats)
          consider(inside ? GEAR_DIRECT_HIT : dist(clat, clng), { kind: 'cell', cell })
        }
      }
      if (layers.gear && gear) {
        // only the items shown on their own (not inside a cluster)
        const shown = new Set(map.queryRenderedFeatures(box, { layers: ['gear', 'gear-sel'] }).map((f) => f.properties.id))
        for (const f of gear.features) {
          if (!shown.has(f.properties.id)) continue
          const [glng, glat] = f.geometry.coordinates
          const d = dist(glat, glng)
          // a direct hit on a gear dot wins over the cell it sits in
          consider(d <= GEAR_DIRECT_HIT ? d - GEAR_DIRECT_HIT : d, { kind: 'gear', gear: f.properties })
        }
      }
      if (layers.reports) {
        for (const report of reports) {
          const d = dist(report.pos.lat, report.pos.lng)
          consider(d <= GEAR_DIRECT_HIT ? d - GEAR_DIRECT_HIT : d, { kind: 'report', report })
        }
      }
      onPick(best)
    }
    map.on('click', onClick)
    return () => {
      map.off('click', onClick)
    }
  }, [map])

  // --- data -> map ---------------------------------------------------------------------------------
  const { cells, prevCells, breaks, layers } = props
  const blend = props.blend ?? 1
  const curRaster = useMemo(() => (cells ? beachingRaster(cells, breaks) : null), [cells, breaks])
  const prevRaster = useMemo(() => (prevCells ? beachingRaster(prevCells, breaks) : null), [prevCells, breaks])

  // live beaching (playback with every stranding loaded): the heat map below replaces the rasters
  const { strandings } = props
  const windowDays = props.windowDays ?? 7
  const live = layers.beaching && time !== null && !!strandings && strandings.length > 0

  // beaching: one day, or (playback) yesterday's and today's 7-day windows cross-faded by the hour
  const shownCells = useRef<CellCollection | null>(null)
  useEffect(() => {
    if (!map || !styleGen) return
    if (live) {
      showRaster(map, 'beach-prev', null, 0, 0)
      showRaster(map, 'beach-cur', null, 0, 0)
      shownCells.current = null
      return
    }
    const on = layers.beaching
    const fading = prevRaster && blend < 1
    if (fading) {
      // ease both ways so the sum doesn't dip mid-way
      showRaster(map, 'beach-prev', on ? prevRaster : null, 1 - blend * blend, stepMs)
      showRaster(map, 'beach-cur', on ? curRaster : null, 1 - (1 - blend) * (1 - blend), stepMs)
      shownCells.current = cells
      return
    }
    showRaster(map, 'beach-prev', null, 0, 0)
    const changed = shownCells.current !== cells
    shownCells.current = cells
    if (changed && time === null && !reducedMotion() && curRaster) {
      // a new date: fade the coast in instead of letting it blink
      showRaster(map, 'beach-cur', on ? curRaster : null, 0.3, 0)
      requestAnimationFrame(() => map.getLayer('beach-cur') && showRaster(map, 'beach-cur', on ? curRaster : null, 1, 350))
    } else {
      showRaster(map, 'beach-cur', on ? curRaster : null, 1, stepMs)
    }
  }, [map, styleGen, curRaster, prevRaster, blend, layers.beaching, cells, time, stepMs, live])

  // the live heat map: strandings in the window [t - windowDays, t) (as the backend's UTC days), each with its weight
  const strandingTimes = useMemo(() => strandings?.map((s) => s[2]) ?? [], [strandings])
  const liveHi = live ? lastAtOrBefore(strandingTimes, time - 1) : -1
  const liveLo = live ? lastAtOrBefore(strandingTimes, time - windowDays * DAY_MS - 1) + 1 : 0
  useEffect(() => {
    if (!map || !styleGen) return
    if (!live || !strandings) {
      map.setLayoutProperty('beach-live', 'visibility', 'none')
      return
    }
    const features: Feature<Point>[] = []
    for (let k = liveLo; k <= liveHi; k++) {
      const [lon, lat, , w] = strandings[k]
      features.push({ type: 'Feature', properties: { w }, geometry: { type: 'Point', coordinates: [lon, lat] } })
    }
    geo(map, 'beach-live')?.setData({ type: 'FeatureCollection', features })
    map.setLayoutProperty('beach-live', 'visibility', 'visible')
  }, [map, styleGen, live, strandings, liveLo, liveHi])

  // its colour scale and radius (from the region's class breaks and latitude)
  const { bbox } = props
  useEffect(() => {
    if (!map || !styleGen) return
    const paint = liveHeatmapPaint(breaks, (bbox[1] + bbox[3]) / 2)
    for (const prop of Object.keys(paint) as (keyof typeof paint)[]) map.setPaintProperty('beach-live', prop, paint[prop])
  }, [map, styleGen, breaks, bbox])

  // drift likelihood heat map
  const driftR = useMemo(() => (props.drift ? driftRaster(props.drift) : null), [props.drift])
  useEffect(() => {
    if (!map || !styleGen) return
    showRaster(map, 'drift-heat', layers.drift ? driftR : null, 1, 0)
  }, [map, styleGen, driftR, layers.drift])

  // particle paths (+ moving heads and stranding squares during playback)
  const { paths, windageFactors } = props
  useEffect(() => {
    if (!map || !styleGen) return
    const f = layers.paths && paths ? pathFeatures(paths, windageFactors, time) : null
    geo(map, 'paths')?.setData(f?.lines ?? EMPTY)
    geo(map, 'heads')?.setData(f?.heads ?? EMPTY)
    geo(map, 'strand')?.setData(f?.spots ?? EMPTY)
  }, [map, styleGen, paths, windageFactors, layers.paths, time])

  // playback: strandings across the region as they happen
  useEffect(() => {
    if (!map || !styleGen) return
    const on = layers.beaching && strandings && strandings.length > 0 && time !== null
    geo(map, 'sparks')?.setData(on ? sparkFeatures(strandings, strandingTimes, time) : EMPTY)
  }, [map, styleGen, strandings, strandingTimes, time, layers.beaching])

  // lost gear (the selected ones bigger, on top)
  const { gear, selectedNets, picked } = props
  const pickedGearId = picked?.kind === 'gear' ? picked.gear.id : null
  useEffect(() => {
    if (!map || !styleGen) return
    const rest: Feature<Point>[] = []
    const chosen: Feature<Point>[] = []
    for (const f of layers.gear && gear ? gear.features : []) {
      const isSel = selectedNets.includes(f.properties.id) || f.properties.id === pickedGearId
      const feature: Feature<Point> = { ...f, properties: { id: f.properties.id, sel: isSel, type: f.properties.gear_type } }
      ;(isSel ? chosen : rest).push(feature)
    }
    geo(map, 'gear')?.setData({ type: 'FeatureCollection', features: rest })
    geo(map, 'gear-sel')?.setData({ type: 'FeatureCollection', features: chosen })
  }, [map, styleGen, gear, selectedNets, pickedGearId, layers.gear])

  // the user's own reports ("Mine funn")
  const { reports } = props
  const pickedReportId = picked?.kind === 'report' ? picked.report.id : null
  useEffect(() => {
    if (!map || !styleGen) return
    geo(map, 'reports')?.setData(
      layers.reports
        ? {
            type: 'FeatureCollection',
            features: reports.map((r) => ({
              type: 'Feature',
              properties: { status: r.status, sel: r.id === pickedReportId },
              geometry: { type: 'Point', coordinates: [r.pos.lng, r.pos.lat] },
            })),
          }
        : EMPTY,
    )
  }, [map, styleGen, reports, pickedReportId, layers.reports])

  const { userPos } = props
  useEffect(() => {
    if (!map || !styleGen) return
    geo(map, 'user')?.setData(
      userPos
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [userPos[1], userPos[0]] } }] }
        : EMPTY,
    )
  }, [map, styleGen, userPos])

  // soft pulsing ring around the tapped item so it stands out on a busy map
  const pulseAt = pickedAt(picked, gear)
  const pulseKey = pulseAt?.join() ?? ''
  useEffect(() => {
    if (!map || !pulseKey) return
    const [lat, lng] = pulseKey.split(',').map(Number)
    const el = document.createElement('div')
    el.innerHTML = '<span class="pulse-ring"></span>'
    el.style.pointerEvents = 'none'
    const marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
    return () => {
      marker.remove()
    }
  }, [map, pulseKey])

  // open where the user is, once their position arrives (unless the container isn't laid out yet: see above)
  const { startPos } = props
  useEffect(() => {
    if (!map || !startPos || unfitted.current) return
    map.flyTo({ center: [startPos[1], startPos[0]], zoom: START_ZOOM, duration: reducedMotion() ? 0 : FLY_MS })
  }, [map, startPos])

  // fly to a hotspot picked in the list
  const { focus } = props
  useEffect(() => {
    if (!map || !focus) return
    // wait for the bottom sheet to finish closing: a camera flight started while the map resizes misses its target
    const t = setTimeout(
      () => map.flyTo({ center: [focus[1], focus[0]], zoom: Math.max(map.getZoom(), FOCUS_ZOOM), duration: FLY_MS }),
      SHEET_SETTLE_MS,
    )
    return () => clearTimeout(t)
  }, [map, focus])

  // zoom to the paths once per new selection (not on every date change or playback step)
  const selectionKey = selectedNets.join()
  const fitted = useRef('')
  useEffect(() => {
    if (!map) return
    if (!selectionKey) fitted.current = '' // cleared: zoom again when the same items are picked later
    if (!paths || paths.length === 0 || fitted.current === selectionKey) return
    fitted.current = selectionKey
    const b = new maplibregl.LngLatBounds()
    for (const p of paths) for (const [lat, lon] of p.coords) b.extend([lon, lat])
    map.fitBounds(b as LngLatBoundsLike, { padding: 24, maxZoom: FIT_MAX_ZOOM, duration: FLY_MS })
  }, [map, paths, selectionKey])

  return <div ref={container} className="h-full w-full" />
})
