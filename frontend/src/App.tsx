import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  type CellCollection,
  type DriftResponse,
  type GearCollection,
  type IndexInfo,
  type ItemBeaching,
  API_URL,
  STATIC,
  fetchBeaching,
  fetchDrift,
  fetchGear,
  fetchIndex,
  fetchItemBeaching,
  fetchPaths,
  type ParticlePath,
} from './api'
import MapView, { type Layers } from './components/Map'
import Logo from './components/Logo'
import Sidebar from './components/Sidebar'

const MAX_DRIFT_NETS = 25 // matches the API cap per /api/drift request
const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_WINDAGE = [0, 0.01, 0.02, 0.03]

function defaultDate(index: IndexInfo): string {
  const today = index.forecast_start.slice(0, 10)
  return index.dates.includes(today) ? today : index.dates[0]
}

export default function App() {
  const [index, setIndex] = useState<IndexInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState<string>('')
  const [gear, setGear] = useState<GearCollection | null>(null)
  const [cells, setCells] = useState<CellCollection | null>(null)
  const [selectedNets, setSelectedNets] = useState<string[]>([])
  const [drift, setDrift] = useState<DriftResponse | null>(null)
  const [paths, setPaths] = useState<{ ids: string[]; paths: ParticlePath[] } | null>(null)
  const [layers, setLayers] = useState<Layers>({ gear: true, beaching: true, paths: true, drift: false })
  const [focus, setFocus] = useState<[number, number] | null>(null)
  // item focus: one lost item whose own beaching chance replaces the regional map
  const [itemId, setItemId] = useState<string | null>(null)
  const [itemBeaching, setItemBeaching] = useState<ItemBeaching | null>(null)

  useEffect(() => {
    Promise.all([fetchIndex(), fetchGear()])
      .then(([idx, g]) => {
        setIndex(idx)
        setGear(g)
        setDate(defaultDate(idx))
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  useEffect(() => {
    if (!date) return
    let stale = false
    fetchBeaching(date)
      .then((c) => !stale && setCells(c))
      .catch((e: Error) => setError(e.message))
    return () => {
      stale = true
    }
  }, [date])

  // particle paths and (if shown) the drift heat map for the selected nets, up to the selected date
  useEffect(() => {
    if (!date || selectedNets.length === 0) return
    let stale = false
    fetchPaths(selectedNets, date)
      .then((p) => !stale && setPaths(p))
      .catch((e: Error) => setError(e.message))
    return () => {
      stale = true
    }
  }, [selectedNets, date])

  useEffect(() => {
    if (!date || selectedNets.length === 0 || !layers.drift) return
    let stale = false
    fetchDrift(selectedNets, date)
      .then((d) => !stale && setDrift(d))
      .catch((e: Error) => setError(e.message))
    return () => {
      stale = true
    }
  }, [selectedNets, date, layers.drift])

  useEffect(() => {
    if (!date || !itemId) return
    let stale = false
    fetchItemBeaching(itemId, date)
      .then((b) => !stale && setItemBeaching(b))
      .catch((e: Error) => setError(e.message))
    return () => {
      stale = true
    }
  }, [itemId, date])

  const showDrift = useCallback((ids: string[]) => {
    setSelectedNets(ids.slice(0, MAX_DRIFT_NETS))
    setLayers((l) => (l.paths || l.drift ? l : { ...l, paths: true }))
  }, [])

  // from a coast-cell popup: paths for the items behind it, regional map stays
  const showCellDrift = useCallback(
    (ids: string[]) => {
      setItemId(null)
      showDrift(ids)
    },
    [showDrift],
  )

  // from a lost-item popup: only this item's beaching chance, plus its paths
  const showItem = useCallback(
    (id: string) => {
      setItemId(id)
      showDrift([id])
    },
    [showDrift],
  )

  const clearSelection = useCallback(() => {
    setItemId(null)
    setSelectedNets([])
  }, [])

  const shownItem = itemBeaching && itemBeaching.id === itemId ? itemBeaching : null
  const shownCells = itemId ? shownItem : cells
  const hotspots = useMemo(
    () =>
      [...(shownCells?.features ?? [])]
        .sort((a, b) => b.properties.expected_nets - a.properties.expected_nets)
        .slice(0, 5),
    [shownCells],
  )
  const itemGear = itemId ? gear?.features.find((f) => f.properties.id === itemId)?.properties : undefined

  if (error && !index) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="flex justify-center">
            <Logo className="h-10 w-auto" />
          </h1>
          <p className="text-ink-2">Could not load the forecast {STATIC ? 'files (data/)' : `from ${API_URL}`}.</p>
          <p className="text-sm text-ink-3">{error}</p>
        </div>
      </div>
    )
  }
  if (!index) return <div className="grid h-full place-items-center text-ink-2">Loading forecast…</div>

  const windowDays = index.beaching_window_days ?? DEFAULT_WINDOW_DAYS
  // only show a heat map that belongs to the current selection (hides stale/cleared ones)
  const shownDrift = drift && drift.ids.join() === selectedNets.join() ? drift : null
  const shownPaths = paths && paths.ids.join() === selectedNets.join() ? paths.paths : null
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <div className="order-2 max-h-[45dvh] border-line md:order-1 md:max-h-none md:w-80 md:shrink-0 md:border-r">
        <Sidebar
          index={index}
          date={date}
          windowDays={windowDays}
          windageFactors={index.wind_drift_factors ?? DEFAULT_WINDAGE}
          onDateChange={setDate}
          hotspots={hotspots}
          onFocus={setFocus}
          layers={layers}
          onToggleLayer={(layer) => setLayers((l) => ({ ...l, [layer]: !l[layer] }))}
          nSelected={selectedNets.length}
          onClearSelection={clearSelection}
          item={itemId ? { gear: itemGear, chance: shownItem?.chance_total ?? null } : null}
        />
      </div>
      <main className="relative order-1 min-h-0 flex-1 md:order-2">
        {index.gear_source === 'mock' && (
          <div className="pointer-events-none absolute right-3 top-3 z-[1000] rounded-md bg-amber-400 px-2 py-1 text-xs font-bold tracking-wide text-amber-950 shadow">
            MOCK DATA
          </div>
        )}
        <MapView
          bbox={index.bbox}
          attribution={index.attribution}
          date={date}
          windowDays={windowDays}
          gear={gear}
          cells={shownCells}
          mode={itemId ? 'item' : 'region'}
          breaks={index.color_breaks ?? []}
          drift={shownDrift}
          paths={shownPaths}
          windageFactors={index.wind_drift_factors ?? DEFAULT_WINDAGE}
          selectedNets={selectedNets}
          layers={layers}
          focus={focus}
          onShowDrift={showCellDrift}
          onShowItem={showItem}
        />
      </main>
    </div>
  )
}
