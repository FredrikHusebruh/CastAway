import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, ImageOverlay, MapContainer, Marker, Pane, TileLayer, useMap, useMapEvents, ZoomControl } from 'react-leaflet'
import type { CellCollection, CellFeature, DriftResponse, GearCollection, GearProps, ParticlePath } from '../api'
import { GEAR_COLOR, SELECTED_COLOR, STRANDED_COLOR, beachingRGBA, driftRGBA, ringCenter, windageColor } from '../format'
import { buildRaster } from '../raster'

export interface Layers {
  gear: boolean
  beaching: boolean
  paths: boolean
  drift: boolean
}

/** 'region' = all items' expected nets; 'item' = one selected item's own chance of washing ashore. */
export type BeachingMode = 'region' | 'item'

/** What the user tapped on the map; shown as a card in the bottom sheet instead of a Leaflet popup. */
export type Picked = { kind: 'gear'; gear: GearProps } | { kind: 'cell'; cell: CellFeature }

interface Props {
  bbox: [number, number, number, number]
  attribution: string
  gear: GearCollection | null
  cells: CellCollection | null
  breaks: number[]
  drift: DriftResponse | null
  paths: ParticlePath[] | null
  windageFactors: number[]
  selectedNets: string[]
  picked: Picked | null
  layers: Layers
  focus: [number, number] | null
  userPos: [number, number] | null // shown as a 'you are here' dot once known
  onMapReady: (map: L.Map) => void // lets the Home button fly back to the region
  onPick: (picked: Picked | null) => void
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// How far (px) from a dot a finger tap still selects it. Small dots need a generous area.
const TAP_RADIUS = 22
// A tap this close (px) to a lost-gear dot means the user is on it, even inside a large 1 km cell.
const GEAR_DIRECT_HIT = 9

// Smoothing radius (in grid cells) of the interpolated rasters: higher = rounder and softer, 0 = plain bilinear.
// Same values as the desktop map (frontend/src/components/Map.tsx).
const BEACHING_SMOOTH_CELLS = 0.7
const DRIFT_SMOOTH_CELLS = 0.8

// Stranded particles are drawn as 100 m squares at true size; particles that strand at (almost) the same
// spot share one square so they don't pile up into blobs.
const STRANDED_SQUARE_M = 100

// Panes, bottom to top: coast cells < drift raster + paths < lost gear (desktop also draws drift above the
// beaching raster). Own panes let the cells fade on their own.
const DRIFT_PANE = 'drift'
const CELLS_PANE = 'cells'
const GEAR_PANE = 'gear'

interface TapProps {
  gear: GearCollection | null
  cells: CellCollection | null
  layers: Layers
  onPick: (picked: Picked | null) => void
}

/**
 * Picks whatever is nearest the tap: a lost-gear dot, a coast cell, or nothing (closes the card).
 * The coast cells are one raster image, and Leaflet's own hit test would give a finger-sized tap to the
 * last-drawn shape rather than the nearest, so taps are resolved here.
 */
function TapPicker({ gear, cells, layers, onPick }: TapProps) {
  const map = useMapEvents({
    click: (e) => {
      const at = e.containerPoint
      const dist = (lat: number, lng: number) => at.distanceTo(map.latLngToContainerPoint([lat, lng]))
      let bestD = TAP_RADIUS
      let best: Picked | null = null
      const consider = (d: number, picked: Picked) => {
        if (d <= bestD) [bestD, best] = [d, picked]
      }
      if (layers.beaching && cells) {
        for (const cell of cells.features) {
          const ring = cell.geometry.coordinates[0]
          const [lat, lng] = ringCenter(ring)
          const inside = L.latLngBounds(ring.map(([lon, la]) => [la, lon] as [number, number])).contains(e.latlng)
          consider(inside ? GEAR_DIRECT_HIT : dist(lat, lng), { kind: 'cell', cell })
        }
      }
      if (layers.gear && gear) {
        for (const f of gear.features) {
          const [lng, lat] = f.geometry.coordinates
          const d = dist(lat, lng)
          // a direct hit on a gear dot wins over the cell it sits in
          consider(d <= GEAR_DIRECT_HIT ? d - GEAR_DIRECT_HIT : d, { kind: 'gear', gear: f.properties })
        }
      }
      onPick(best)
    },
  })
  return null
}

/** Lost-gear dot radius by zoom: a phone shows the whole coast one zoom level further out than desktop, so
 *  full-size dots would hide the beaching glow there. Taps don't depend on it (TapPicker uses a fixed radius). */
function gearRadius(zoom: number): number {
  return zoom <= 8 ? 3 : zoom <= 9 ? 4 : 5
}

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  useEffect(() => onZoom(map.getZoom()), [map, onZoom])
  return null
}

function MapReady({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap()
  useEffect(() => onReady(map), [map, onReady])
  return null
}

/** The bottom sheet grows and shrinks; Leaflet only tracks window resizes, so watch the container too. */
function ResizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false })) // pans to keep the same centre
    ro.observe(map.getContainer())
    return () => ro.disconnect()
  }, [map])
  return null
}

/** Size [dlon, dlat] of a cell from its polygon ring. */
function ringSize(ring: number[][]): [number, number] {
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats)]
}

/** Beaching cells as one smooth interpolated viridis raster (as on desktop). Taps are handled by TapPicker. */
function BeachingLayer({ cells, breaks }: { cells: CellCollection; breaks: number[] }) {
  const raster = useMemo(() => {
    const feats = cells.features
    if (feats.length === 0) return null
    const grid = feats.map((f) => {
      const [lat, lon] = ringCenter(f.geometry.coordinates[0])
      return { lat, lon, v: f.properties.expected_nets }
    })
    return buildRaster(grid, ringSize(feats[0].geometry.coordinates[0]), (v) => beachingRGBA(v, breaks), {
      smoothCells: BEACHING_SMOOTH_CELLS,
    })
  }, [cells, breaks])
  return raster && <ImageOverlay url={raster.url} bounds={raster.bounds} interactive={false} />
}

/** Drift likelihood as a smooth interpolated viridis raster. */
function DriftLayer({ drift }: { drift: DriftResponse }) {
  const raster = useMemo(
    () =>
      buildRaster(drift.cells.map(([lat, lon, v]) => ({ lat, lon, v })), drift.cell_deg, driftRGBA, {
        smoothCells: DRIFT_SMOOTH_CELLS,
      }),
    [drift],
  )
  return raster && <ImageOverlay url={raster.url} bounds={raster.bounds} interactive={false} />
}

function strandingSpots(paths: ParticlePath[]): [number, number][] {
  const spots = new Map<string, [number, number]>()
  for (const p of paths) {
    if (!p.stranded) continue
    const [lat, lon] = p.coords[p.coords.length - 1]
    const key = `${Math.round(lat / 0.0009)},${Math.round(lon / 0.0017)}` // ~100 m grid at 58-70 N
    if (!spots.has(key)) spots.set(key, [lat, lon])
  }
  return [...spots.values()]
}

/**
 * Particle trajectories ("spaghetti") coloured by windage, plus 100 m squares where they stranded, all drawn on
 * ONE canvas (same as desktop): positions are projected once per selection, points closer than ~1 px are
 * skipped, each windage colour is stroked in one batch, and the canvas is redrawn when panning/zooming ends.
 */
function PathsCanvas({ paths, factors }: { paths: ParticlePath[]; factors: number[] }) {
  const map = useMap()
  useEffect(() => {
    // project once at zoom 0; at zoom z a pixel position is just that times 2^z
    const projected = paths.map((p) => {
      const xy = new Float64Array(p.coords.length * 2)
      p.coords.forEach(([lat, lon], k) => {
        const pt = map.project([lat, lon], 0)
        xy[2 * k] = pt.x
        xy[2 * k + 1] = pt.y
      })
      return { xy, color: windageColor(p.wdf, factors), wdf: p.wdf }
    })
    // draw low windage last so the less wind-driven paths stay visible on top
    projected.sort((a, b) => b.wdf - a.wdf)
    const colors = [...new Set(projected.map((p) => p.color))]
    const spots = strandingSpots(paths)

    const canvas = L.DomUtil.create('canvas', 'leaflet-zoom-hide') as HTMLCanvasElement
    map.getPane(DRIFT_PANE)?.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    const draw = () => {
      if (!ctx) return
      const size = map.getSize()
      const dpr = window.devicePixelRatio || 1
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      canvas.style.width = `${size.x}px`
      canvas.style.height = `${size.y}px`
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.x, size.y)

      const scale = 2 ** map.getZoom()
      const ref = map.getCenter()
      const refPx = map.project(ref, 0)
      const refCp = map.latLngToContainerPoint(ref)
      const ox = refCp.x - refPx.x * scale
      const oy = refCp.y - refPx.y * scale

      ctx.lineWidth = 1.5
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.75
      for (const color of colors) {
        ctx.beginPath()
        for (const p of projected) {
          if (p.color !== color) continue
          let lastX = Infinity
          let lastY = Infinity
          for (let k = 0; k < p.xy.length; k += 2) {
            const x = p.xy[k] * scale + ox
            const y = p.xy[k + 1] * scale + oy
            if (k === 0) ctx.moveTo(x, y)
            else if (Math.abs(x - lastX) + Math.abs(y - lastY) >= 1 || k === p.xy.length - 2) ctx.lineTo(x, y)
            else continue
            lastX = x
            lastY = y
          }
        }
        ctx.strokeStyle = color
        ctx.stroke()
      }

      // stranding spots: true-size 100 m squares (at least 2 px so they never vanish)
      ctx.globalAlpha = 0.95
      ctx.fillStyle = STRANDED_COLOR
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      for (const [lat, lon] of spots) {
        const metersPerPx = (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * scale)
        const side = Math.max(STRANDED_SQUARE_M / metersPerPx, 2)
        const c = map.latLngToContainerPoint([lat, lon])
        ctx.fillRect(c.x - side / 2, c.y - side / 2, side, side)
        if (side >= 6) ctx.strokeRect(c.x - side / 2, c.y - side / 2, side, side)
      }
    }
    draw()
    // 'resize' covers the bottom sheet growing/shrinking (ResizeWatcher -> invalidateSize)
    map.on('moveend zoomend resize viewreset', draw)
    return () => {
      map.off('moveend zoomend resize viewreset', draw)
      canvas.remove()
    }
  }, [map, paths, factors])
  return null
}

/** Zoom to the paths once per new selection (not on every date change). */
function FitToPaths({ paths, selectionKey }: { paths: ParticlePath[] | null; selectionKey: string }) {
  const map = useMap()
  const fitted = useRef('')
  useEffect(() => {
    if (!paths || paths.length === 0 || fitted.current === selectionKey) return
    fitted.current = selectionKey
    const bounds = L.latLngBounds(paths.flatMap((p) => p.coords))
    map.flyToBounds(bounds, { padding: [24, 24], maxZoom: 12, duration: 0.8 })
  }, [paths, selectionKey, map])
  return null
}

/** Cross-fades the coast cells when they change (e.g. a new date) instead of letting them blink. */
function CellsFade({ cells }: { cells: CellCollection | null }) {
  const map = useMap()
  useEffect(() => {
    if (!cells || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    map.getPane(CELLS_PANE)?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' })
  }, [cells, map])
  return null
}

const PULSE_ICON = L.divIcon({ className: '', html: '<span class="pulse-ring"></span>', iconSize: [0, 0] })

/** Soft pulsing ring around the tapped item so it stands out on a busy map. */
function PickedPulse({ picked, gear }: { picked: Picked | null; gear: GearCollection | null }) {
  let at: [number, number] | null = null
  if (picked?.kind === 'cell') at = ringCenter(picked.cell.geometry.coordinates[0])
  if (picked?.kind === 'gear') {
    const f = gear?.features.find((g) => g.properties.id === picked.gear.id)
    if (f) at = [f.geometry.coordinates[1], f.geometry.coordinates[0]]
  }
  return at && <Marker position={at} icon={PULSE_ICON} interactive={false} keyboard={false} />
}

function FlyTo({ focus }: { focus: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (focus) map.flyTo(focus, Math.max(map.getZoom(), 11), { duration: 0.8 })
  }, [focus, map])
  return null
}

export default function MapView(props: Props) {
  const [w, s, e, n] = props.bbox
  const [zoom, setZoom] = useState(0)
  const pickedGearId = props.picked?.kind === 'gear' ? props.picked.gear.id : null
  const { onPick } = props
  return (
    <MapContainer
      bounds={[
        [s, w],
        [n, e],
      ]}
      className="h-full w-full"
      zoomSnap={1} // fractional zoom shows hairline gaps between OSM tiles
      zoomControl={false} // added below with a fixed position, as on desktop
      preferCanvas // one canvas per pane for the gear dots: cheaper than SVG on phones
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={`${OSM_ATTRIBUTION} | ${props.attribution}`}
      />
      <ZoomControl position="topleft" />
      <MapReady onReady={props.onMapReady} />
      <ResizeWatcher />
      <ZoomWatcher onZoom={setZoom} />
      <TapPicker gear={props.gear} cells={props.cells} layers={props.layers} onPick={onPick} />
      <FlyTo focus={props.focus} />
      <FitToPaths paths={props.paths} selectionKey={props.selectedNets.join()} />

      <Pane name={CELLS_PANE} style={{ zIndex: 405, pointerEvents: 'none' }}>
        {props.layers.beaching && props.cells && <BeachingLayer cells={props.cells} breaks={props.breaks} />}
      </Pane>
      <CellsFade cells={props.cells} />

      <Pane name={DRIFT_PANE} style={{ zIndex: 410, pointerEvents: 'none' }}>
        {props.layers.drift && props.drift && <DriftLayer drift={props.drift} />}
        {props.layers.paths && props.paths && <PathsCanvas paths={props.paths} factors={props.windageFactors} />}
      </Pane>

      <Pane name={GEAR_PANE} style={{ zIndex: 420, pointerEvents: 'none' }}>
        {props.layers.gear &&
          props.gear?.features.map((f) => {
            const selected = props.selectedNets.includes(f.properties.id) || f.properties.id === pickedGearId
            return (
              <CircleMarker
                key={f.properties.id}
                center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
                radius={selected ? 7 : gearRadius(zoom)}
                pathOptions={{
                  color: '#ffffff',
                  weight: selected ? 3 : zoom <= 8 ? 1 : 1.5,
                  fillColor: selected ? SELECTED_COLOR : GEAR_COLOR,
                  fillOpacity: 0.95,
                }}
                interactive={false}
              />
            )
          })}
        {props.userPos && (
          <CircleMarker
            center={props.userPos}
            radius={8}
            interactive={false}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
          />
        )}
      </Pane>
      <PickedPulse picked={props.picked} gear={props.gear} />
    </MapContainer>
  )
}
