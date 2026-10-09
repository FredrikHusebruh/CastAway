import { type RGBA, logPosition, rampAt } from './raster'

// Beaching ramp: viridis (user's choice), dark purple = low, yellow = strongest hotspots; drawn as a smooth
// interpolated raster. Opacity rises with value so the many low-value cells recede and hotspots stand out.
// Values mirror --ramp-1..5 in index.css.
export const RAMP = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] as const
export const RAMP_OPACITY = [0.3, 0.45, 0.65, 0.85, 0.95] as const
export const GEAR_COLOR = '#1e293b'
export const REPORT_COLOR = '#0f766e' // the user's own reports ("Mine funn"); teal, outside the viridis ramps

// Viridis (user's choice): perceptually uniform, colour-blind safe; dark purple = low, yellow = high.
export const VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] as const
export const DRIFT_RAMP = VIRIDIS
const DRIFT_OPACITY = [0.75, 0.75, 0.75, 0.75, 0.75] as const
const DRIFT_MIN = 0.01 // relative likelihood shown at the bottom of the scale; below it the heat map fades out
export const SELECTED_COLOR = VIRIDIS[0]

// Particle paths are coloured by windage on the same viridis scale: purple = no wind push, yellow = 3%.
export const WINDAGE_RAMP = ['#440154', '#31688e', '#35b779', '#fde725'] as const
export const STRANDED_COLOR = '#f03b20'

export function windageColor(wdf: number, factors: number[]): string {
  const k = factors.findIndex((f) => Math.abs(f - wdf) < 1e-6)
  return WINDAGE_RAMP[Math.min(Math.max(k, 0), WINDAGE_RAMP.length - 1)]
}

/** Log-scale range of the beaching colour scale, one break-step beyond the first and last class break. */
export function beachingRange(breaks: number[]): [number, number] {
  if (breaks.length === 0) return [1e-4, 1e-1]
  const ratio = breaks.length > 1 ? breaks[1] / breaks[0] : 3
  return [breaks[0] / ratio, breaks[breaks.length - 1] * ratio]
}

/** Beaching colour for an (interpolated) value; fades to transparent below the bottom of the scale. */
export function beachingRGBA(v: number, breaks: number[]): RGBA {
  const [lo, hi] = beachingRange(breaks)
  const c = rampAt(RAMP, RAMP_OPACITY, logPosition(Math.max(v, lo), lo, hi))
  return v < lo ? [c[0], c[1], c[2], c[3] * (v / lo)] : c
}

/** Drift-likelihood colour (viridis on a log scale from 1% to 100% of the top cell). */
export function driftRGBA(v: number): RGBA {
  const c = rampAt(DRIFT_RAMP, DRIFT_OPACITY, logPosition(Math.max(v, DRIFT_MIN), DRIFT_MIN, 1))
  return v < DRIFT_MIN ? [c[0], c[1], c[2], c[3] * (v / DRIFT_MIN)] : c
}

/** Expected nets are small fractions; show two significant digits. */
export function formatNets(value: number): string {
  if (value === 0) return '0'
  if (value >= 10) return value.toFixed(0)
  return value.toPrecision(2).replace('.', ',') // Norwegian decimal comma
}

/** A probability (0-1) as a percentage, e.g. 0.036 -> "3.6 %". */
export function formatPercent(p: number): string {
  const pct = p * 100
  if (pct === 0) return '0 %'
  if (pct < 0.1) return '<0,1 %'
  return `${pct < 10 ? pct.toFixed(1).replace('.', ',') : pct.toFixed(0)} %`
}

const GEAR_LABELS: Record<string, string> = {
  nets: 'Garn',
  longline: 'Line',
  crab_pot: 'Krabbeteine',
  fish_pot: 'Fisketeine',
  seine: 'Not',
  sensor_cable: 'Sensor / kabel',
  generic: 'Annet redskap',
  unknown: 'Ukjent redskap',
}

export const gearLabel = (type: string): string => GEAR_LABELS[type] ?? type

export function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('nb-NO', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('nb-NO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}

/** Short UTC timestamp for the header, e.g. "9. okt., 06:00 UTC". */
export function formatUpdated(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  return `${day}, ${time} UTC`
}

/** Directions link to a point: Apple Maps on iPhone/iPad, Google Maps elsewhere. */
export function directionsUrl([lat, lng]: [number, number]): string {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? `https://maps.apple.com/?daddr=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
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
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`
}
