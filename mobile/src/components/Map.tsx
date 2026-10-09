import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polygon, Polyline, Rectangle, TileLayer, useMap, useMapEvents } from 'react-leaflet'
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
  onMapReady: (map: L.Map) => void // lets the Home button fly back to the region
  onPick: (picked: Picked | null) => void
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// 1 km cells are only a few pixels wide at region zoom, so below this zoom they are drawn as dots.
const CELL_POLYGON_MIN_ZOOM = 11
// Extra hit area (px) around canvas shapes so small dots are easy to tap with a finger.
const TAP_TOLERANCE = 12

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  useEffect(() => onZoom(map.getZoom()), [map, onZoom])
  return null
}

/** Tapping empty map closes the detail card. Shapes set bubblingMouseEvents: false, so their taps don't land here. */
function BlankTap({ onTap }: { onTap: () => void }) {
  useMapEvents({ click: onTap })
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
  onPick: (picked: Picked) => void
}

function BeachingLayer({ cells, breaks, date, zoom, pickedId, onPick }: BeachingProps) {
  // draw ascending so the highest-value cells end up on top
  const features = [...cells.features].sort((a, b) => a.properties.expected_nets - b.properties.expected_nets)
  return features.map((f) => {
    const picked = f.properties.cell_id === pickedId
    const pathOptions = {
      color: picked ? SELECTED_COLOR : RAMP[RAMP.length - 1],
      weight: picked ? 3 : 1,
      fillColor: rampColor(f.properties.expected_nets, breaks),
      fillOpacity: 0.9,
      bubblingMouseEvents: false,
    }
    const key = `${date}-${f.properties.cell_id}`
    const eventHandlers = { click: () => onPick({ kind: 'cell', cell: f }) }
    const ring = f.geometry.coordinates[0]
    return zoom >= CELL_POLYGON_MIN_ZOOM ? (
      <Polygon
        key={key}
        positions={ring.map(([lon, lat]) => [lat, lon] as [number, number])}
        pathOptions={pathOptions}
        eventHandlers={eventHandlers}
      />
    ) : (
      <CircleMarker
        key={key}
        center={ringCenter(ring)}
        radius={picked ? 8 : 6}
        pathOptions={pathOptions}
        eventHandlers={eventHandlers}
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
  // one canvas for all tappable shapes: cheaper than SVG on phones and supports a tap tolerance
  const renderer = useMemo(() => L.canvas({ tolerance: TAP_TOLERANCE }), [])
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
      zoomControl={false} // pinch to zoom; the buttons only take space on a phone
      renderer={renderer}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={`${OSM_ATTRIBUTION} | ${props.attribution}`}
      />
      <MapReady onReady={props.onMapReady} />
      <ResizeWatcher />
      <BlankTap onTap={() => onPick(null)} />
      <FlyTo focus={props.focus} />
      <ZoomWatcher onZoom={setZoom} />
      <FitToPaths paths={props.paths} selectionKey={props.selectedNets.join()} />

      {props.layers.drift && props.drift && <DriftLayer drift={props.drift} />}
      {props.layers.paths && props.paths && <PathsLayer paths={props.paths} factors={props.windageFactors} />}

      {props.layers.beaching && props.cells && (
        <BeachingLayer
          cells={props.cells}
          breaks={props.breaks}
          date={props.date}
          zoom={zoom}
          pickedId={pickedCellId}
          onPick={onPick}
        />
      )}

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
                bubblingMouseEvents: false,
              }}
              eventHandlers={{ click: () => onPick({ kind: 'gear', gear: f.properties }) }}
            />
          )
        })}
    </MapContainer>
  )
}
