import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Marker,
  Pane,
  Polygon,
  Polyline,
  Rectangle,
  TileLayer,
  useMap,
  useMapEvents,
  ZoomControl,
} from 'react-leaflet'
import type { CellCollection, CellFeature, DriftResponse, GearCollection, GearProps, ParticlePath } from '../api'
import { GEAR_COLOR, RAMP, SELECTED_COLOR, STRANDED_COLOR, driftColor, rampColor, ringCenter, windageColor } from '../format'

export interface Layers {
  gear: boolean
  beaching: boolean
  paths: boolean
  drift: boolean
}

/** What the user tapped on the map; shown as a card in the bottom sheet instead of a Leaflet popup. */
export type Picked = { kind: 'gear'; gear: GearProps } | { kind: 'cell'; cell: CellFeature }

interface Props {
  bbox: [number, number, number, number]
  attribution: string
  date: string
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

// 1 km cells are only a few pixels wide at region zoom, so below this zoom they are drawn as dots.
const CELL_POLYGON_MIN_ZOOM = 11
// How far (px) from a dot a finger tap still selects it. Small dots need a generous area.
const TAP_RADIUS = 22
// A tap this close (px) to a lost-gear dot means the user is on it, even inside a large 1 km cell polygon.
const GEAR_DIRECT_HIT = 9

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  useEffect(() => onZoom(map.getZoom()), [map, onZoom])
  return null
}

interface TapProps {
  gear: GearCollection | null
  cells: CellCollection | null
  layers: Layers
  onPick: (picked: Picked | null) => void
}

/**
 * Picks whatever is nearest the tap: a lost-gear dot, a coast cell, or nothing (closes the card).
 * Leaflet's own hit test gives a tap to the last-drawn shape within the tolerance, so with finger-sized
 * tolerances a neighbouring coast cell would steal taps aimed at a lost-gear dot.
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
        const polygons = map.getZoom() >= CELL_POLYGON_MIN_ZOOM
        for (const cell of cells.features) {
          const ring = cell.geometry.coordinates[0]
          const [lat, lng] = ringCenter(ring)
          const inside =
            polygons &&
            L.latLngBounds(ring.map(([lon, la]) => [la, lon] as [number, number])).contains(e.latlng)
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

interface BeachingProps {
  cells: CellCollection
  breaks: number[]
  date: string
  zoom: number
  pickedId: string | null
}

function BeachingLayer({ cells, breaks, date, zoom, pickedId }: BeachingProps) {
  // draw ascending so the highest-value cells end up on top
  const features = [...cells.features].sort((a, b) => a.properties.expected_nets - b.properties.expected_nets)
  return features.map((f) => {
    const picked = f.properties.cell_id === pickedId
    const pathOptions = {
      color: picked ? SELECTED_COLOR : RAMP[RAMP.length - 1],
      weight: picked ? 3 : 1,
      fillColor: rampColor(f.properties.expected_nets, breaks),
      fillOpacity: 0.9,
    }
    const key = `${date}-${f.properties.cell_id}`
    const ring = f.geometry.coordinates[0]
    return zoom >= CELL_POLYGON_MIN_ZOOM ? (
      <Polygon
        key={key}
        positions={ring.map(([lon, lat]) => [lat, lon] as [number, number])}
        pathOptions={pathOptions}
        interactive={false}
      />
    ) : (
      <CircleMarker
        key={key}
        center={ringCenter(ring)}
        radius={picked ? 8 : 6}
        pathOptions={pathOptions}
        interactive={false}
      />
    )
  })
}

/** Drift likelihood as a grid heat map, drawn on one canvas (can be thousands of cells). */
function DriftLayer({ drift }: { drift: DriftResponse }) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), [])
  const [dlon, dlat] = drift.cell_deg
  return drift.cells.map(([lat, lon, v]) => (
    <Rectangle
      key={`${lat},${lon}`}
      bounds={[
        [lat - dlat / 2, lon - dlon / 2],
        [lat + dlat / 2, lon + dlon / 2],
      ]}
      interactive={false}
      pathOptions={{ renderer, stroke: false, fillColor: driftColor(v), fillOpacity: 0.55 }}
    />
  ))
}

/** Individual particle trajectories ("spaghetti"), coloured by windage; dots where they stranded. */
function PathsLayer({ paths, factors }: { paths: ParticlePath[]; factors: number[] }) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), [])
  // draw low windage last so the less wind-driven paths stay visible on top
  const ordered = [...paths].sort((a, b) => b.wdf - a.wdf)
  return (
    <>
      {ordered.map((p, k) => (
        <Polyline
          key={`${p.id}-${k}`}
          positions={p.coords}
          interactive={false}
          pathOptions={{ renderer, color: windageColor(p.wdf, factors), weight: 1.5, opacity: 0.75 }}
        />
      ))}
      {ordered
        .filter((p) => p.stranded)
        .map((p, k) => (
          <CircleMarker
            key={`${p.id}-end-${k}`}
            center={p.coords[p.coords.length - 1]}
            radius={2.5}
            interactive={false}
            pathOptions={{ renderer, stroke: false, fillColor: STRANDED_COLOR, fillOpacity: 0.9 }}
          />
        ))}
    </>
  )
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
    map.getPane('cells')?.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 350, easing: 'ease-out' })
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
  const pickedCellId = props.picked?.kind === 'cell' ? props.picked.cell.properties.cell_id : null
  const { onPick } = props
  return (
    <MapContainer
      bounds={[
        [s, w],
        [n, e],
      ]}
      className="h-full w-full"
      zoomSnap={0.5}
      zoomControl={false} // added below with a fixed position, as on desktop
      preferCanvas // one canvas per pane: cheaper than SVG on phones (taps are handled by TapPicker)
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={`${OSM_ATTRIBUTION} | ${props.attribution}`}
      />
      <ZoomControl position="topleft" />
      <MapReady onReady={props.onMapReady} />
      <ResizeWatcher />
      <TapPicker gear={props.gear} cells={props.cells} layers={props.layers} onPick={onPick} />
      <FlyTo focus={props.focus} />
      <ZoomWatcher onZoom={setZoom} />
      <FitToPaths paths={props.paths} selectionKey={props.selectedNets.join()} />

      {props.layers.drift && props.drift && <DriftLayer drift={props.drift} />}
      {props.layers.paths && props.paths && <PathsLayer paths={props.paths} factors={props.windageFactors} />}

      {/* own panes, stacked drift < paths < coast cells < lost gear, so the cells can fade on their own */}
      <Pane name="cells" style={{ zIndex: 410 }}>
        {props.layers.beaching && props.cells && (
          <BeachingLayer
            cells={props.cells}
            breaks={props.breaks}
            date={props.date}
            zoom={zoom}
            pickedId={pickedCellId}
          />
        )}
      </Pane>
      <CellsFade cells={props.cells} />

      <Pane name="gear" style={{ zIndex: 420 }}>
      {props.layers.gear &&
        props.gear?.features.map((f) => {
          const selected = props.selectedNets.includes(f.properties.id) || f.properties.id === pickedGearId
          return (
            <CircleMarker
              key={f.properties.id}
              center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
              radius={selected ? 8 : 6}
              pathOptions={{
                color: '#ffffff',
                weight: selected ? 3 : 1.5,
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
