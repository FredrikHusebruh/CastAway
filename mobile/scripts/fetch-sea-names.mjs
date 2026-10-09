// Fetches names of fjords, bays, sounds and seas in northern Norway from OpenStreetMap (Overpass API) and writes
// src/seaNames.json for the map's water labels. The OpenFreeMap tiles carry no marine names here (only lakes), so this
// fills the gap. Run once (or to refresh): node scripts/fetch-sea-names.mjs
// One request, a User-Agent, results cached in git: as Overpass's usage policy asks. Data © OpenStreetMap (ODbL).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const BAYS_BBOX = '68.3,14.0,71.4,32.0' // s,w,n,e: Troms and Finnmark
const SEAS_BBOX = '66,10,76,40'
const OUT = new URL('../src/seaNames.json', import.meta.url)
// Seas are huge: OSM's label point for the Barents Sea lies far out towards Novaya Zemlya. Extra label points near the
// coast, so the sea's name shows in the forecast regions: [lon, lat, name, kind, minzoom].
const EXTRA_LABELS = [
  [27.5, 71.45, 'Barentshavet', 'sea', 4],
  [31.5, 70.75, 'Barentshavet', 'sea', 7],
  [17.5, 70.3, 'Norskehavet', 'sea', 5],
]

const query = `[out:json][timeout:180];
(nwr["natural"~"^(bay|strait)$"]["name"](${BAYS_BBOX});nwr["place"~"^(sea|ocean)$"]["name"](${SEAS_BBOX}););
out geom;` // "out tags geom" would drop the relation members (and with them the shape)

/** The Overpass response; with OVERPASS_CACHE=<file> it is read from / saved to that file (to rerun without asking). */
async function overpass() {
  const cache = process.env.OVERPASS_CACHE
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'))
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'User-Agent': 'CastAway-hackathon-prototype/0.1 (sea name labels)', Accept: 'application/json' },
    body: new URLSearchParams({ data: query }),
  })
  if (!res.ok) throw new Error(`Overpass: ${res.status} (busy? try again in a minute)`)
  const raw = await res.json()
  if (cache) writeFileSync(cache, JSON.stringify(raw))
  return raw
}
const { elements } = await overpass()

/** Norwegian name: name:no, else the first part of a multilingual "Norsk - Sámi - Suomi" name. */
const nameOf = (tags) => (tags['name:no'] ?? tags.name).split(' - ')[0].trim()

/** All line segments of an element's geometry (ways, and the member ways of relations), as [[lon, lat], [lon, lat]]. */
function segments(el) {
  const lines = el.type === 'way' ? [el.geometry] : (el.members ?? []).filter((m) => m.geometry).map((m) => m.geometry)
  const out = []
  for (const line of lines)
    for (let i = 1; i < line.length; i++) out.push([[line[i - 1].lon, line[i - 1].lat], [line[i].lon, line[i].lat]])
  return out
}

// Even-odd ray casting works on unordered segments, so relations need no ring assembly.
function inside([x, y], segs) {
  let hit = false
  for (const [[x1, y1], [x2, y2]] of segs)
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) hit = !hit
  return hit
}

/** Squared distance (in km-ish units: lon scaled by cos lat) from p to the nearest segment. */
function edgeDistance([x, y], segs) {
  const k = Math.cos((y * Math.PI) / 180)
  let best = Infinity
  for (const [[x1, y1], [x2, y2]] of segs) {
    const [ax, ay, bx, by, px, py] = [x1 * k, y1, x2 * k, y2, x * k, y]
    const [dx, dy] = [bx - ax, by - ay]
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
    best = Math.min(best, (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2)
  }
  return best
}

const kmBetween = ([x1, y1], [x2, y2]) => Math.hypot((x2 - x1) * 111 * Math.cos((y1 * Math.PI) / 180), (y2 - y1) * 111)

/** Many fjords are mapped as an open line along their axis: the name is written along it. Returns the line, its
 * midpoint and its length in km. */
function placeAlongLine(el) {
  const line = el.geometry.map((g) => [g.lon, g.lat])
  let length = 0
  for (let i = 1; i < line.length; i++) length += kmBetween(line[i - 1], line[i])
  let walked = 0
  let at = line[0]
  for (let i = 1; i < line.length; i++) {
    const d = kmBetween(line[i - 1], line[i])
    if (walked + d >= length / 2) {
      const f = (length / 2 - walked) / (d || 1)
      at = [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * f, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * f]
      break
    }
    walked += d
  }
  return { at, sizeKm: length, line }
}

/** A label point well inside the water area (best of a grid over its bbox), or null if none is found; and the area's
 * size in km. */
function placeLabel(el) {
  const segs = segments(el)
  const { minlon, minlat, maxlon, maxlat } = el.bounds
  const sizeKm = Math.hypot((maxlon - minlon) * 111 * Math.cos((minlat * Math.PI) / 180), (maxlat - minlat) * 111)
  let best = null
  let bestD = -1
  const N = 16
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const p = [minlon + ((maxlon - minlon) * i) / N, minlat + ((maxlat - minlat) * j) / N]
      if (!inside(p, segs)) continue
      const d = edgeDistance(p, segs)
      if (d > bestD) [best, bestD] = [p, d]
    }
  return { at: best, sizeKm }
}

/** The zoom from which a name shows: big seas and fjords early, small bays late. Whole zooms: MapLibre evaluates
 * zoom in GeoJSON filters per tile (integer) zoom. */
function minZoom(kind, sizeKm, name) {
  if (kind === 'sea' || kind === 'ocean') return 3
  if (sizeKm > 60) return 5
  if (sizeKm > 25) return 6
  if (sizeKm > 8) return 8
  if (sizeKm > 2 || /fjorden$/.test(name)) return 10
  return 11
}

const round = (v) => Math.round(v * 1e4) / 1e4
const isOpenWay = (el) => {
  const g = el.type === 'way' ? el.geometry : null
  return !!g && g.length > 1 && (g[0].lon !== g[g.length - 1].lon || g[0].lat !== g[g.length - 1].lat)
}

const names = []
let skipped = 0
for (const el of elements) {
  const kind = el.tags.place ?? el.tags.natural
  const name = nameOf(el.tags)
  const placed =
    el.type === 'node' ? { at: [el.lon, el.lat], sizeKm: 0 } : isOpenWay(el) ? placeAlongLine(el) : placeLabel(el)
  if (!placed.at) {
    skipped++ // a polygon we couldn't find water inside: better no name than a name on land
    continue
  }
  const entry = [round(placed.at[0]), round(placed.at[1]), name, kind === 'strait' ? 'strait' : kind === 'bay' ? 'bay' : 'sea']
  entry.push(minZoom(kind, placed.sizeKm, name))
  if (placed.line) entry.push(placed.line.map(([x, y]) => [round(x), round(y)]))
  names.push(entry)
}
names.push(...EXTRA_LABELS)
names.sort((a, b) => a[4] - b[4]) // bigger areas first: MapLibre places earlier features first when labels collide

writeFileSync(OUT, JSON.stringify({ source: 'OpenStreetMap contributors (ODbL), via Overpass', fields: ['lon', 'lat', 'name', 'kind', 'minzoom', 'line?'], names }) + '\n')
console.log(`wrote ${names.length} names to ${OUT.pathname} (${skipped} skipped: no water found inside)`)
