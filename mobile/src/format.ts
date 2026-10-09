// Beaching ramp (light -> dark); values mirror --ramp-1..5 in index.css (Leaflet styles need hex).
export const RAMP = ['#ef8a55', '#e2622c', '#c24a1c', '#963511', '#6b2208'] as const
export const GEAR_COLOR = '#1e293b'

// Drift-likelihood heat map: one violet hue, light -> dark, validated as an ordinal ramp against the
// OSM sea colour (#aad3df; lightest step 2.06:1). Classes are on relative likelihood (top cell = 1).
export const DRIFT_RAMP = ['#8d80e6', '#6f5fd8', '#5444bd', '#3a2b95', '#231766'] as const
export const DRIFT_BREAKS = [0.02, 0.05, 0.15, 0.4]
export const DRIFT_LABELS = ['Very low', 'Low', 'Medium', 'High', 'Very high']
export const SELECTED_COLOR = DRIFT_RAMP[4]

// Particle paths are coloured by windage (ordinal): steps of the same validated violet ramp, light = no wind.
export const WINDAGE_RAMP = [DRIFT_RAMP[0], DRIFT_RAMP[2], DRIFT_RAMP[3], DRIFT_RAMP[4]] as const
export const STRANDED_COLOR = RAMP[2]

export function windageColor(wdf: number, factors: number[]): string {
  const k = factors.findIndex((f) => Math.abs(f - wdf) < 1e-6)
  return WINDAGE_RAMP[Math.min(Math.max(k, 0), WINDAGE_RAMP.length - 1)]
}

/** Class index 0..RAMP.length-1 for a value, given ascending class breaks. */
export function classIndex(value: number, breaks: number[]): number {
  const i = breaks.findIndex((b) => value < b)
  return Math.min(i === -1 ? breaks.length : i, RAMP.length - 1)
}

export function rampColor(value: number, breaks: number[]): string {
  return RAMP[classIndex(value, breaks)]
}

export function driftColor(likelihood: number): string {
  return DRIFT_RAMP[classIndex(likelihood, DRIFT_BREAKS)]
}

/** Expected nets are small fractions; show two significant digits. */
export function formatNets(value: number): string {
  if (value === 0) return '0'
  if (value >= 10) return value.toFixed(0)
  return value.toPrecision(2)
}

const GEAR_LABELS: Record<string, string> = {
  nets: 'Gillnet',
  longline: 'Long line',
  crab_pot: 'Crab pot',
  fish_pot: 'Fish pot',
  seine: 'Seine',
  sensor_cable: 'Sensor / cable',
  generic: 'Other gear',
  unknown: 'Unknown gear',
}

export const gearLabel = (type: string): string => GEAR_LABELS[type] ?? type

export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/** Centre of a polygon ring as [lat, lng]. */
export function ringCenter(ring: number[][]): [number, number] {
  const lons = ring.map((p) => p[0])
  const lats = ring.map((p) => p[1])
  return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]
}

/** Great-circle distance in km between two [lat, lng] points. */
export function distanceKm([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(a))
}

export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
