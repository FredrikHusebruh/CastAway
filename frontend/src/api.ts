import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'
import { getStatic, staticDrift, staticItemBeaching, staticPaths } from './staticData'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export interface IndexInfo {
  region: string
  bbox: [number, number, number, number] // west, south, east, north
  dates: string[]
  expected_nets_per_date: Record<string, number> // 7-day totals ending on each date
  beaching_window_days?: number
  drift_cell_km?: number
  wind_drift_factors?: number[]
  window_start: string
  forecast_start: string
  forecast_end: string
  run_timestamp: string
  n_nets: number
  particles_per_net: number
  cell_size_km: number
  color_breaks?: number[] // absent in output from older pipeline versions
  gear_source: string
  attribution: string
}

export interface GearProps {
  id: string
  lost_time: string
  gear_type: string
  float_prob: number
}

export interface CellProps {
  cell_id: string
  expected_nets: number
  particle_count: number
  n_nets: number
  contributing_net_ids: string[]
}

export interface DriftResponse {
  ids: string[]
  cell_deg: [number, number] // [dlon, dlat]
  cells: [number, number, number][] // [lat, lon, relative likelihood 0..1], ascending
}

export interface ParticlePath {
  id: string
  wdf: number // wind drift factor (windage)
  stranded: boolean // had stranded by the end of the requested date
  coords: [number, number][] // [lat, lon], every output step (thinned when many nets are selected)
}

export type GearCollection = FeatureCollection<Point, GearProps>
export type CellCollection = FeatureCollection<Polygon, CellProps>
export type CellFeature = Feature<Polygon, CellProps>

/** coast.json: ~1 km cells of the region that contain coast (cell i,j covers lon i*dlon.., lat j*dlat..). */
export interface CoastInfo {
  cell_deg: [number, number] // [dlon, dlat]
  bbox?: [number, number, number, number] // area covered: the region plus a margin, so edges see nearby coast
  cells: [number, number][] // [i, j]
}

/** One item's beaching cells: expected_nets = its total chance of washing ashore there (float chance included). */
export type ItemBeaching = CellCollection & { id: string; chance_total: number; float_prob: number }

// VITE_STATIC=true: read precomputed files (static web hosting, see staticData.ts); otherwise the FastAPI server.
export const STATIC: boolean = import.meta.env.VITE_STATIC === 'true'

async function getJson<T>(path: string): Promise<T> {
  // no-cache: output files keep their names across pipeline runs, so always revalidate with the server
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
  return (await res.json()) as T
}

const idList = (ids: string[]) => ids.map(encodeURIComponent).join(',')

export const fetchIndex = () => (STATIC ? getStatic<IndexInfo>('index.json') : getJson<IndexInfo>('/api/dates'))
export const fetchGear = () =>
  STATIC ? getStatic<GearCollection>('lost_gear.geojson') : getJson<GearCollection>('/api/gear')
export const fetchBeaching = (date: string) =>
  STATIC
    ? getStatic<CellCollection>(`beaching_${date}.geojson`)
    : getJson<CellCollection>(`/api/beaching?date=${date}`)
export const fetchCoast = () => (STATIC ? getStatic<CoastInfo>('coast.json') : getJson<CoastInfo>('/api/coast'))
export const fetchItemBeaching = (id: string, date: string) =>
  STATIC
    ? staticItemBeaching(id, date)
    : getJson<ItemBeaching>(`/api/net/${encodeURIComponent(id)}/beaching?date=${date}`)

export const fetchPaths = (ids: string[], date: string) =>
  STATIC
    ? staticPaths(ids, date)
    : getJson<{ ids: string[]; paths: ParticlePath[] }>(`/api/paths?ids=${idList(ids)}&date=${date}`)

export const fetchDrift = (ids: string[], date: string) =>
  STATIC ? staticDrift(ids, date) : getJson<DriftResponse>(`/api/drift?ids=${idList(ids)}&date=${date}`)
