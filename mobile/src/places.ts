// Place names for coast cells, from Kartverket's public place-name service (Norway only, free, no key).
// "Kvalvika, Vardø" reads better than "70.396°N 31.127°E". When the service can't answer (offline, outside
// Norway), callers fall back to coordinates.
import { useEffect, useState } from 'react'

const STEDSNAVN_URL = 'https://ws.geonorge.no/stedsnavn/v1/punkt'
const RADIUS_M = 5000 // the service's maximum
const COAST_FEATURE_MAX_M = 2000 // a bay or headland further away than this doesn't describe the spot

// Settlements, nearest first, name the area; a nearby bay, beach or headland pins the spot down.
const SETTLEMENT_TYPES = new Set(['By', 'Tettsted', 'Tettsteddel', 'Bydel', 'Bygdelag (bygd)', 'Bygd', 'Grend', 'Fiskevær'])
const COAST_TYPES = new Set([
  'Vik i sjø',
  'Bukt i sjø',
  'Strand i sjø',
  'Nes i sjø',
  'Halvøy i sjø',
  'Øy i sjø',
  'Holme i sjø',
  'Sund i sjø',
  'Fjord',
  'Havn',
])

interface Hit {
  meterFraPunkt: number
  navneobjekttype: string
  stedsnavn: { skrivemåte: string }[]
}

const cache = new Map<string, Promise<string | null>>()

async function lookup(lat: number, lon: number): Promise<string | null> {
  const url = `${STEDSNAVN_URL}?nord=${lat}&ost=${lon}&koordsys=4258&utkoordsys=4258&radius=${RADIUS_M}&treffPerSide=500&side=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const hits = ((await res.json()) as { navn?: Hit[] }).navn ?? []
  const nearest = (types: Set<string>, maxM = Infinity) =>
    hits
      .filter((h) => types.has(h.navneobjekttype) && h.meterFraPunkt <= maxM && h.stedsnavn[0]?.skrivemåte)
      .sort((a, b) => a.meterFraPunkt - b.meterFraPunkt)[0]?.stedsnavn[0].skrivemåte
  const coast = nearest(COAST_TYPES, COAST_FEATURE_MAX_M)
  const town = nearest(SETTLEMENT_TYPES)
  if (coast && town && coast !== town) return `${coast}, ${town}`
  return coast ?? town ?? null
}

/** Name of the place at [lat, lon] (rounded to ~100 m so neighbouring calls share a request), or null. */
export function placeName(lat: number, lon: number): Promise<string | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  let hit = cache.get(key)
  if (!hit) {
    hit = lookup(Number(lat.toFixed(3)), Number(lon.toFixed(3))).catch(() => null)
    cache.set(key, hit)
  }
  return hit
}

/** React hook: the place name once known (undefined while loading, null if there is none). */
export function usePlaceName(lat: number, lon: number): string | null | undefined {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  const [named, setNamed] = useState<{ key: string; name: string | null } | null>(null)
  useEffect(() => {
    let live = true
    void placeName(lat, lon).then((name) => live && setNamed({ key, name }))
    return () => {
      live = false
    }
  }, [key, lat, lon])
  return named?.key === key ? named.name : undefined
}
