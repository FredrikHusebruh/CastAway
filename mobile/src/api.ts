import type { Feature, FeatureCollection, Point, Polygon } from 'geojson'

// Empty = same origin: the Vite dev server proxies /api to the backend, so phones on the LAN work without CORS changes.
export const API_URL: string = import.meta.env.VITE_API_URL ?? ''

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
  coords: [number, number][] // [lat, lon], hourly (thinned when many nets are selected)
}

export type GearCollection = FeatureCollection<Point, GearProps>
export type CellCollection = FeatureCollection<Polygon, CellProps>
export type CellFeature = Feature<Polygon, CellProps>

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
  return (await res.json()) as T
}

export const fetchIndex = () => getJson<IndexInfo>('/api/dates')
export const fetchGear = () => getJson<GearCollection>('/api/gear')
export const fetchBeaching = (date: string) => getJson<CellCollection>(`/api/beaching?date=${date}`)
export const fetchPaths = (ids: string[], date: string) =>
  getJson<{ ids: string[]; paths: ParticlePath[] }>(`/api/paths?ids=${ids.map(encodeURIComponent).join(',')}&date=${date}`)

export const fetchDrift = (ids: string[], date: string) =>
  getJson<DriftResponse>(`/api/drift?ids=${ids.map(encodeURIComponent).join(',')}&date=${date}`)
