import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  Rectangle,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import type { CellCollection, CellFeature, DriftResponse, GearCollection, ParticlePath } from '../api'
import {
  GEAR_COLOR,
  RAMP,
  SELECTED_COLOR,
  STRANDED_COLOR,
  driftColor,
  formatDateTime,
  formatNets,
  gearLabel,
  rampColor,
  ringCenter,
  windageColor,
} from '../format'
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
}

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

// 1 km cells are only a few pixels wide at region zoom, so below this zoom they are drawn as dots.
const CELL_POLYGON_MIN_ZOOM = 11

function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) })
  useEffect(() => onZoom(map.getZoom()), [map, onZoom])
  return null
}

interface BeachingProps {
  cells: CellCollection
  breaks: number[]
  date: string
  windowDays: number
  zoom: number
  onShowDrift: (netIds: string[]) => void
}

function BeachingLayer({ cells, breaks, date, windowDays, zoom, onShowDrift }: BeachingProps) {
  // draw ascending so the highest-value cells end up on top
  const features = [...cells.features].sort((a, b) => a.properties.expected_nets - b.properties.expected_nets)
  const style = (f: CellFeature) => ({
    color: RAMP[RAMP.length - 1],
    weight: 1,
    fillColor: rampColor(f.properties.expected_nets, breaks),
    fillOpacity: 0.9,
  })
  return features.map((f) => {
    const key = `${date}-${f.properties.cell_id}`
    const children = (
      <>
        <Tooltip sticky>{formatNets(f.properties.expected_nets)} expected nets</Tooltip>
        <Popup>
          <CellPopup cell={f.properties} date={date} windowDays={windowDays} onShowDrift={onShowDrift} />
        </Popup>
      </>
    )
    const ring = f.geometry.coordinates[0]
    return zoom >= CELL_POLYGON_MIN_ZOOM ? (
      <Polygon key={key} positions={ring.map(([lon, lat]) => [lat, lon] as [number, number])} pathOptions={style(f)}>
        {children}
      </Polygon>
    ) : (
      <CircleMarker key={key} center={ringCenter(ring)} radius={5} pathOptions={style(f)}>
        {children}
      </CircleMarker>
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
  const [zoom, setZoom] = useState(0)
  return (
    <MapContainer
      bounds={[
        [s, w],
        [n, e],
      ]}
      className="h-full w-full"
      zoomSnap={0.5}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution={`${OSM_ATTRIBUTION} | ${props.attribution}`}
      />
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
          windowDays={props.windowDays}
          zoom={zoom}
          onShowDrift={props.onShowDrift}
        />
      )}

      {props.layers.gear &&
        props.gear?.features.map((f) => {
          const selected = props.selectedNets.includes(f.properties.id)
          return (
          <CircleMarker
            key={f.properties.id}
            center={[f.geometry.coordinates[1], f.geometry.coordinates[0]]}
            radius={selected ? 7 : 5}
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
                  onClick={() => props.onShowDrift([f.properties.id])}
                >
                  Show where it drifts
                </button>
              </div>
            </Popup>
          </CircleMarker>
          )
        })}
    </MapContainer>
  )
}
