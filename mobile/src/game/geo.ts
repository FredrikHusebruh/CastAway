// Where a report is, in terms of the forecast: near the coast?, in a hotspot?, which lost items could it be?
// Reads the same files as the map (coast.json, beaching_<date>.geojson, lost_gear.geojson).
import type { CellCollection, CellFeature, CoastInfo, GearProps, GearCollection } from '../api'
import { distanceKm, ringCenter } from '../format'
import { COAST_MAX_KM, type CoastCheck, HOTSPOT_KM, STRETCH_KM } from './rules'

const KM_PER_DEG_LAT = 111.32
const MATCH_KM = 2 // lost items whose forecast strandings are this close to a find are suggested as matches
const MAX_CANDIDATES = 5

interface LatLng {
  lat: number
  lng: number
}

/** Set of "i,j" coast-cell keys, built once per coast.json. */
export function coastSet(coast: CoastInfo): Set<string> {
  return new Set(coast.cells.map(([i, j]) => `${i},${j}`))
}

/**
 * 'near' if a coast cell is within COAST_MAX_KM, 'far' if not, 'unknown' outside the forecast area
 * (coast.json only covers the region's bbox).
 */
export function coastCheck(
  pos: LatLng,
  coast: CoastInfo | null,
  cells: Set<string> | null,
  bbox: [number, number, number, number],
): CoastCheck {
  const [w, s, e, n] = bbox
  if (!coast || !cells || pos.lng < w || pos.lng > e || pos.lat < s || pos.lat > n) return 'unknown'
  const [dlon, dlat] = coast.cell_deg
  const i0 = Math.floor(pos.lng / dlon)
  const j0 = Math.floor(pos.lat / dlat)
  const cellKm = dlat * KM_PER_DEG_LAT
  const r = Math.ceil(COAST_MAX_KM / cellKm) + 1
  for (let di = -r; di <= r; di++) {
    for (let dj = -r; dj <= r; dj++) {
      if (!cells.has(`${i0 + di},${j0 + dj}`)) continue
      const centre: [number, number] = [(j0 + dj + 0.5) * dlat, (i0 + di + 0.5) * dlon]
      // measured to the cell centre, so allow half a cell diagonal on top
      if (distanceKm([pos.lat, pos.lng], centre) <= COAST_MAX_KM + 0.71 * cellKm) return 'near'
    }
  }
  return 'far'
}

/** "Medium chance or more": the second class break of the beaching colour scale (log-spaced, 5 classes). */
export function hotspotThreshold(breaks: number[]): number {
  return breaks.length > 1 ? breaks[1] : (breaks[0] ?? Infinity)
}

function containsPoint(cell: CellFeature, pos: LatLng): boolean {
  const ring = cell.geometry.coordinates[0]
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return pos.lng >= Math.min(...lons) && pos.lng < Math.max(...lons) && pos.lat >= Math.min(...lats) && pos.lat < Math.max(...lats)
}

/** The forecast coast cell a position is in, else the nearest within HOTSPOT_KM; and whether it is a hotspot. */
export function hotspotAt(
  pos: LatLng,
  cells: CellCollection | null,
  breaks: number[],
): { cell: CellFeature | null; hotspot: boolean } {
  if (!cells) return { cell: null, hotspot: false }
  let best: CellFeature | null = null
  let bestKm = HOTSPOT_KM
  for (const cell of cells.features) {
    if (containsPoint(cell, pos)) {
      best = cell
      break
    }
    const km = distanceKm([pos.lat, pos.lng], ringCenter(cell.geometry.coordinates[0]))
    if (km <= bestKm) [best, bestKm] = [cell, km]
  }
  return { cell: best, hotspot: !!best && best.properties.expected_nets >= hotspotThreshold(breaks) }
}

export interface Candidate {
  gear: GearProps
  km: number // from where it was lost
}

/**
 * Reported lost items that may be this find: the same gear type, and forecast to strand within MATCH_KM
 * (the items behind the coast cells around the find). Nearest loss position first.
 */
export function matchCandidates(
  pos: LatLng,
  gearType: string,
  cells: CellCollection | null,
  gear: GearCollection | null,
): Candidate[] {
  if (!cells || !gear) return []
  const ids = new Set<string>()
  for (const cell of cells.features) {
    if (distanceKm([pos.lat, pos.lng], ringCenter(cell.geometry.coordinates[0])) <= MATCH_KM) {
      for (const id of cell.properties.contributing_net_ids) ids.add(id)
    }
  }
  return gear.features
    .filter((f) => ids.has(f.properties.id) && f.properties.gear_type === gearType)
    .map((f) => ({ gear: f.properties, km: distanceKm([pos.lat, pos.lng], [f.geometry.coordinates[1], f.geometry.coordinates[0]]) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, MAX_CANDIDATES)
}

/** Stretch of coast: a STRETCH_KM grid cell. "First find on a stretch this season" is per key. */
export function stretchKey(pos: LatLng): string {
  const dlat = STRETCH_KM / KM_PER_DEG_LAT
  const j = Math.floor(pos.lat / dlat)
  const dlon = dlat / Math.cos(((j + 0.5) * dlat * Math.PI) / 180) // from the row's centre, so keys are stable
  return `${j}_${Math.floor(pos.lng / dlon)}`
}

/** The forecast date a report belongs to: its own day if forecast, else the nearest one. */
export function forecastDateFor(day: string, dates: string[]): string | null {
  if (dates.length === 0) return null
  if (dates.includes(day)) return day
  return day < dates[0] ? dates[0] : dates[dates.length - 1]
}
