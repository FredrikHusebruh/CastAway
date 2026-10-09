import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  ImageOverlay,
  MapContainer,
  Pane,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { CellCollection, CellFeature, DriftResponse, GearCollection, ParticlePath } from '../api'
import {
  GEAR_COLOR,
  SELECTED_COLOR,
  STRANDED_COLOR,
  beachingRGBA,
  driftRGBA,
  formatDateTime,
  gearLabel,
  ringCenter,
  windageColor,
} from '../format'
import { buildRaster } from '../raster'
import CellPopup from './CellPopup'

export interface Layers {
  gear: boolean
  beaching: boolean
  paths: boolean
  drift: boolean
}

interface Props {
  bbox: [number, number, number, number]
  attribution: string
  date: string
  windowDays: number
  gear: GearCollection | null
  cells: CellCollection | null
  breaks: number[]
  drift: DriftResponse | null
  paths: ParticlePath[] | null
  windageFactors: number[]
  selectedNets: string[]
  layers: Layers
  focus: [number, number] | null
  onShowDrift: (netIds: string[]) => void
  onShowItem: (netId: string) => void
  mode: BeachingMode
}

/** 'region' = all items' expected nets; 'item' = one selected item's own chance of washing ashore. */
export type BeachingMode = 'region' | 'item'

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// Stranded particles are drawn as 100 m squares at true size; particles that strand at (almost) the same
// spot share one square so they don't pile up into blobs.
const STRANDED_SQUARE_M = 100

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

interface BeachingProps {
  cells: CellCollection
  breaks: number[]
  date: string
  windowDays: number
  mode: BeachingMode
  onShowDrift: (netIds: string[]) => void
}

// Smoothing radius (in grid cells) of the interpolated rasters: higher = rounder and softer, 0 = plain bilinear.
const BEACHING_SMOOTH_CELLS = 0.7
const DRIFT_SMOOTH_CELLS = 0.8

/** Size [dlon, dlat] of a cell from its polygon ring. */
function ringSize(ring: number[][]): [number, number] {
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats)]
}

/** Beaching cells as one smooth interpolated raster; clicking the map opens the nearest cell's popup. */
function BeachingLayer({ cells, breaks, date, windowDays, mode, onShowDrift }: BeachingProps) {
  const [selected, setSelected] = useState<{ date: string; cell: CellFeature } | null>(null)
  const { raster, size, byId } = useMemo(() => {
    const feats = cells.features
    if (feats.length === 0) return { raster: null, size: [0, 0] as [number, number], byId: new Map<string, CellFeature>() }
    const size = ringSize(feats[0].geometry.coordinates[0])
    const grid = feats.map((f) => {
      const [lat, lon] = ringCenter(f.geometry.coordinates[0])
      return { lat, lon, v: f.properties.expected_nets }
    })
    return {
      raster: buildRaster(grid, size, (v) => beachingRGBA(v, breaks), { smoothCells: BEACHING_SMOOTH_CELLS }),
      size,
      byId: new Map(feats.map((f) => [f.properties.cell_id, f])),
    }
  }, [cells, breaks])

  useMapEvents({
    click: (e) => {
      // cell ids are global grid indices "i_j" (floor(lon / dlon), floor(lat / dlat)); pick the best cell within 1
      const [dlon, dlat] = size
      if (!dlon) return
      const i = Math.floor(e.latlng.lng / dlon)
      const j = Math.floor(e.latlng.lat / dlat)
      const neighbours = [-1, 0, 1].flatMap((di) => [-1, 0, 1].map((dj) => byId.get(`${i + di}_${j + dj}`)))
      const best =
        byId.get(`${i}_${j}`) ??
        neighbours.reduce<CellFeature | undefined>(
          (b, f) => (f && (!b || f.properties.expected_nets > b.properties.expected_nets) ? f : b),
          undefined,
        )
      setSelected(best ? { date, cell: best } : null)
    },
  })

  const open = selected && selected.date === date ? selected.cell : null
  return (
    <>
      {raster && <ImageOverlay url={raster.url} bounds={raster.bounds} interactive={false} />}
      {open && (
        <Popup position={ringCenter(open.geometry.coordinates[0])} eventHandlers={{ remove: () => setSelected(null) }}>
          <CellPopup cell={open.properties} date={date} windowDays={windowDays} mode={mode} onShowDrift={onShowDrift} />
        </Popup>
      )}
    </>
  )
}

// Drift layers sit in their own pane above the beaching raster, and let clicks through.
const DRIFT_PANE = 'drift'

/** Drift likelihood as a smooth interpolated viridis raster. */
function DriftLayer({ drift }: { drift: DriftResponse }) {
  const raster = useMemo(
    () =>
      buildRaster(drift.cells.map(([lat, lon, v]) => ({ lat, lon, v })), drift.cell_deg, driftRGBA, {
        smoothCells: DRIFT_SMOOTH_CELLS,
      }),
    [drift],
  )
  return raster && <ImageOverlay url={raster.url} bounds={raster.bounds} interactive={false} pane={DRIFT_PANE} />
}

/**
 * Particle trajectories ("spaghetti") coloured by windage, plus 100 m squares where they stranded, all drawn on
 * ONE canvas. Hundreds of separate Leaflet polylines get laggy; here positions are projected once per selection,
 * points closer than ~1 px are skipped, each windage colour is stroked in a single batch, and the canvas is only
 * redrawn when panning/zooming ends (it is hidden during the zoom animation, like Leaflet's own layers).
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
    map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 12, duration: 0.8 })
  }, [paths, selectionKey, map])
  return null
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
  return (
    <MapContainer
      bounds={[
        [s, w],
        [n, e],
      ]}
      className="h-full w-full"
      zoomSnap={1} // fractional zoom shows hairline gaps between OSM tiles
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={`${OSM_ATTRIBUTION} | ${props.attribution}`}
      />
      <FlyTo focus={props.focus} />
      <FitToPaths paths={props.paths} selectionKey={props.selectedNets.join()} />

      {props.layers.beaching && props.cells && (
        <BeachingLayer
          cells={props.cells}
          breaks={props.breaks}
          date={props.date}
          windowDays={props.windowDays}
          mode={props.mode}
          onShowDrift={props.onShowDrift}
        />
      )}

      <Pane name={DRIFT_PANE} style={{ zIndex: 450, pointerEvents: 'none' }}>
        {props.layers.drift && props.drift && <DriftLayer drift={props.drift} />}
        {props.layers.paths && props.paths && <PathsCanvas paths={props.paths} factors={props.windageFactors} />}
      </Pane>

      {props.layers.gear &&
        props.gear?.features.map((f) => {
          const selected = props.selectedNets.includes(f.properties.id)
          return (
          <CircleMarker
            key={f.properties.id}
            center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
            radius={selected ? 7 : 5}
            bubblingMouseEvents={false}
            pathOptions={{
              color: '#ffffff',
              weight: selected ? 3 : 1.5,
              fillColor: selected ? SELECTED_COLOR : GEAR_COLOR,
              fillOpacity: 0.95,
            }}
          >
            <Popup>
              <div className="min-w-44 space-y-1 text-sm">
                <div className="font-semibold">{gearLabel(f.properties.gear_type)}</div>
                <div className="text-stone-600">Lost {formatDateTime(f.properties.lost_time)}</div>
                <div className="text-stone-600">Floats: ~{Math.round(f.properties.float_prob * 100)}% chance</div>
                <button
                  type="button"
                  className="text-sm font-medium text-[#4a3aa7] underline underline-offset-2 hover:no-underline"
                  onClick={() => props.onShowItem(f.properties.id)}
                >
                  Show where it washes ashore
                </button>
              </div>
            </Popup>
          </CircleMarker>
          )
        })}
    </MapContainer>
  )
}
