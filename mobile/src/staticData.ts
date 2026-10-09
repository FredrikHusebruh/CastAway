// Static mode (VITE_STATIC=true): the site reads the pipeline's output files from ./data/ next to index.html
// (or from VITE_DATA_URL), so it runs on plain web hosting with no Python server. The endpoints that combine
// per-item files are reproduced here; keep them in sync with backend/castaway/aggregate.py and api.py:
//   trimPaths      <-> aggregate.trim_paths   (+ api.paths thinning)
//   combineDrift   <-> aggregate.combine_drift
//   itemBeaching   <-> aggregate.item_window_cells + cells_geojson (api.net_beaching)
import type { CellCollection, CellFeature, DriftResponse, IndexInfo, ItemBeaching, ParticlePath } from './api'

// Where the forecast files are. Default ./data next to index.html (the app at castaway/); the debug map is built
// with VITE_DATA_URL=../data so that from castaway/debug/ it reads the same castaway/data/. No trailing slash.
const DATA_URL: string = (import.meta.env.VITE_DATA_URL ?? `${import.meta.env.BASE_URL}data`).replace(/\/+$/, '')
const MAX_NETS = 25 // config.MAX_DRIFT_NETS
const KM_PER_DEG_LAT = 111.32
const DAY_MS = 86_400_000

export async function getStatic<T>(file: string): Promise<T> {
  // no-cache: file names repeat across daily builds, so always revalidate
  const res = await fetch(`${DATA_URL}/${file}`, { cache: 'no-cache' })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${DATA_URL}/${file}`)
  return (await res.json()) as T
}

/** A per-item file: null if it doesn't exist (404); network errors are retried once, then thrown. */
async function getOptional<T>(file: string): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${DATA_URL}/${file}`, { cache: 'no-cache' })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${DATA_URL}/${file}`)
      return (await res.json()) as T
    } catch (e) {
      if (attempt >= 1) throw e
    }
  }
}

/** Load per-item files a few at a time (selecting a coast cell can mean 25 files of ~0.5 MB each). */
async function loadAll<T>(files: string[], concurrency = 4): Promise<(T | null)[]> {
  const out: (T | null)[] = new Array(files.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const k = next++
      out[k] = await getOptional<T>(files[k])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker))
  return out
}

const cleanIds = (ids: string[]) => ids.filter((i) => /^[A-Za-z0-9-]{1,64}$/.test(i)).slice(0, MAX_NETS)
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d
const endOfDay = (day: string) => Date.parse(`${day}T00:00:00Z`) + DAY_MS

// --- particle paths ---------------------------------------------------------------------------
interface NetPaths {
  start: string
  step_minutes?: number
  particles: { wdf: number; first: number; stranded: boolean; coords: [number, number][] }[]
}

function trimPaths(nets: Record<string, NetPaths>, until: string, perFactor: number, step: number): ParticlePath[] {
  const out: ParticlePath[] = []
  for (const [id, net] of Object.entries(nets)) {
    const stepMs = (net.step_minutes ?? 60) * 60_000
    const limit = Math.trunc((endOfDay(until) - Date.parse(net.start)) / stepMs) - 1
    const taken = new Map<number, number>()
    for (const p of net.particles) {
      const n = taken.get(p.wdf) ?? 0
      if (n >= perFactor) continue
      taken.set(p.wdf, n + 1)
      const coords = p.coords.slice(0, Math.max(limit - p.first + 1, 0))
      if (coords.length < 2) continue
      const thinned = coords.filter((_, i) => i % step === 0)
      if ((coords.length - 1) % step) thinned.push(coords[coords.length - 1])
      out.push({
        id,
        wdf: p.wdf,
        stranded: p.stranded && coords.length === p.coords.length,
        coords: thinned.map(([x, y]) => [y, x]),
      })
    }
  }
  return out
}

export async function staticPaths(ids: string[], date: string) {
  const netIds = cleanIds(ids)
  const loaded = await loadAll<NetPaths>(netIds.map((i) => `paths/${i}.json`))
  const nets: Record<string, NetPaths> = {}
  netIds.forEach((i, k) => {
    const net = loaded[k]
    if (net) nets[i] = net
  })
  // same thinning as api.paths: full detail for a few nets, coarser when many are selected
  const [perFactor, step] = netIds.length <= 3 ? [6, 1] : netIds.length <= 10 ? [4, 4] : [2, 8]
  return { ids: netIds, paths: trimPaths(nets, date, perFactor, step) }
}

// --- drift likelihood -------------------------------------------------------------------------
interface NetDrift {
  weight: number
  days: Record<string, [number, number, number][]>
}

function combineDrift(nets: NetDrift[], until: string, [dlon, dlat]: [number, number]): [number, number, number][] {
  const acc = new Map<string, [number, number, number]>()
  for (const net of nets) {
    const cells = Object.entries(net.days)
      .filter(([day]) => day <= until)
      .flatMap(([, cs]) => cs)
    const total = cells.reduce((sum, c) => sum + c[2], 0)
    for (const [i, j, n] of cells) {
      const key = `${i},${j}`
      const cur = acc.get(key) ?? [i, j, 0]
      cur[2] += (net.weight * n) / total
      acc.set(key, cur)
    }
  }
  if (!acc.size) return []
  const top = Math.max(...[...acc.values()].map((c) => c[2]))
  return [...acc.values()]
    .map(([i, j, v]) => [round((j + 0.5) * dlat, 5), round((i + 0.5) * dlon, 5), round(v / top, 4)] as [number, number, number])
    .sort((a, b) => a[2] - b[2])
}

export async function staticDrift(ids: string[], date: string): Promise<DriftResponse> {
  const netIds = cleanIds(ids)
  const [index, loaded] = await Promise.all([
    getStatic<{ drift_cell_deg: [number, number] }>('index.json'),
    loadAll<NetDrift>(netIds.map((i) => `drift/${i}.json`)),
  ])
  const nets = loaded.filter((n): n is NetDrift => n !== null)
  return { ids: netIds, cell_deg: index.drift_cell_deg, cells: combineDrift(nets, date, index.drift_cell_deg) }
}

// --- one item's beaching chance ------------------------------------------------------------------
interface ItemStrandings {
  float_prob: number
  strandings: [number, number, string, number][] // lon, lat, iso time, weight
}

export async function staticItemBeaching(id: string, date: string): Promise<ItemBeaching> {
  const [index, item] = await Promise.all([
    getStatic<IndexInfo>('index.json'),
    getStatic<ItemStrandings>(`strandings/${encodeURIComponent(id)}.json`),
  ])
  const [, south, , north] = index.bbox
  const lat0 = (south + north) / 2
  const dlat = index.cell_size_km / KM_PER_DEG_LAT
  const dlon = dlat / Math.cos((lat0 * Math.PI) / 180)
  const windowDays = index.beaching_window_days ?? 7
  const first = new Date(Date.parse(`${date}T00:00:00Z`) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10)

  const cells = new Map<string, { i: number; j: number; sum: number; count: number }>()
  for (const [lon, lat, time, weight] of item.strandings) {
    const day = new Date(Date.parse(time)).toISOString().slice(0, 10)
    if (day < first || day > date) continue
    const i = Math.floor(lon / dlon)
    const j = Math.floor(lat / dlat)
    const key = `${i}_${j}`
    const cell = cells.get(key) ?? { i, j, sum: 0, count: 0 }
    cell.sum += weight
    cell.count += 1
    cells.set(key, cell)
  }
  const features: CellFeature[] = [...cells.entries()].map(([cellId, c]) => {
    const w = c.i * dlon
    const s = c.j * dlat
    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [w + dlon, s],
            [w + dlon, s + dlat],
            [w, s + dlat],
            [w, s],
          ],
        ],
      },
      properties: {
        cell_id: cellId,
        expected_nets: round(c.sum, 4),
        particle_count: c.count,
        n_nets: 1,
        contributing_net_ids: ['item'],
      },
    }
  })
  const total = [...cells.values()].reduce((sum, c) => sum + c.sum, 0)
  const collection: CellCollection = { type: 'FeatureCollection', features }
  return { ...collection, id, float_prob: item.float_prob, chance_total: round(total, 5) }
}
