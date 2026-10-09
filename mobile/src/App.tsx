import type L from 'leaflet'
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type CellCollection,
  type DriftResponse,
  type GearCollection,
  type IndexInfo,
  API_URL,
  fetchBeaching,
  fetchDrift,
  fetchGear,
  fetchIndex,
  fetchPaths,
  type ParticlePath,
} from './api'
import DateBar from './components/DateBar'
import DetailCard from './components/DetailCard'
import Guide from './components/Guide'
import ComingSoon from './components/ComingSoon'
import { HelpIcon, HomeIcon, LeaderboardIcon, ProfileIcon, ReportIcon } from './components/Icons'
import MapView, { type Layers, type Picked } from './components/Map'
import SheetTabs from './components/Sheet'

const MAX_DRIFT_NETS = 25 // matches the API cap per /api/drift request
const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_WINDAGE = [0, 0.01, 0.02, 0.03]

function defaultDate(index: IndexInfo): string {
  const today = index.forecast_start.slice(0, 10)
  return index.dates.includes(today) ? today : index.dates[0]
}

const floatingBtn =
  'pointer-events-auto grid h-11 min-w-11 place-items-center rounded-full bg-surface px-3 text-sm font-medium text-ink shadow-md active:opacity-80'
const navBtn = 'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium active:bg-surface-2'

// Bottom-bar screens other than the map. All are placeholders for now: accounts, leaderboards and
// found-net reporting are out of scope for the prototype (CLAUDE.md), so these are the extension points.
type Screen = 'leaderboard' | 'report' | 'profile'
const NAV: { screen: Screen; label: string; Icon: () => JSX.Element; text: string }[] = [
  {
    screen: 'leaderboard',
    label: 'Leaderboard',
    Icon: LeaderboardIcon,
    text: 'See who has cleaned up the most lost gear along the coast.',
  },
  {
    screen: 'report',
    label: 'Rapportering',
    Icon: ReportIcon,
    text: 'Report lost or found fishing gear, with photo and position.',
  },
  {
    screen: 'profile',
    label: 'Profile',
    Icon: ProfileIcon,
    text: 'Sign in and follow the beaches you care about.',
  },
]

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
  const [picked, setPicked] = useState<Picked | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [overlay, setOverlay] = useState<'guide' | Screen | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const onMapReady = useCallback((map: L.Map) => {
    mapRef.current = map
  }, [])

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
      .then((c) => {
        if (stale) return
        setCells(c)
        // a picked cell belongs to one date's 7-day window; drop it when the date changes
        setPicked((p) => (p?.kind === 'cell' ? null : p))
      })
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

  const showDrift = useCallback((ids: string[]) => {
    setSelectedNets(ids.slice(0, MAX_DRIFT_NETS))
    setLayers((l) => (l.paths || l.drift ? l : { ...l, paths: true }))
    setPicked(null)
    setExpanded(false) // give the map the room to show the paths
  }, [])

  const pick = useCallback((p: Picked | null) => {
    setPicked(p)
    if (p) setExpanded(false)
  }, [])

  const focusHotspot = useCallback((latLng: [number, number]) => {
    setFocus(latLng)
    setExpanded(false)
  }, [])

  const goHome = () => {
    const map = mapRef.current
    if (!map || !index) return
    const [w, s, e, n] = index.bbox
    map.flyToBounds(
      [
        [s, w],
        [n, e],
      ],
      { duration: 0.8 },
    )
    setPicked(null)
    setExpanded(false)
    setOverlay(null)
  }

  const openGuide = () => {
    // the guide points at the collapsed panel, so start from the plain map view
    setPicked(null)
    setExpanded(false)
    setOverlay('guide')
  }
  const closeOverlay = useCallback(() => setOverlay(null), [])

  const hotspots = useMemo(
    () => [...(cells?.features ?? [])].sort((a, b) => b.properties.expected_nets - a.properties.expected_nets).slice(0, 5),
    [cells],
  )

  if (error && !index) {
    return (
      <div className="grid h-dvh place-items-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-bold">CastAway</h1>
          <p className="text-ink-2">Could not load the forecast from {API_URL || 'the backend'}.</p>
          <p className="text-sm text-ink-3">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 h-11 rounded-full bg-ink px-5 text-sm font-semibold text-surface"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
  if (!index) return <div className="grid h-dvh place-items-center text-ink-2">Loading forecast…</div>

  const windowDays = index.beaching_window_days ?? DEFAULT_WINDOW_DAYS
  const windageFactors = index.wind_drift_factors ?? DEFAULT_WINDAGE
  // only show a heat map / paths that belong to the current selection (hides stale/cleared ones)
  const shownDrift = drift && drift.ids.join() === selectedNets.join() ? drift : null
  const shownPaths = paths && paths.ids.join() === selectedNets.join() ? paths.paths : null

  return (
    <div className="flex h-dvh flex-col bg-surface text-ink">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight tracking-tight">CastAway</h1>
          <p className="truncate text-xs text-ink-2">Where will lost fishing gear wash ashore?</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {index.gear_source === 'mock' && (
            <span className="rounded-md bg-amber-400 px-2 py-1 text-xs font-bold tracking-wide text-amber-950">
              MOCK DATA
            </span>
          )}
          <button
            type="button"
            onClick={openGuide}
            data-tour="help"
            className="grid h-10 w-10 place-items-center rounded-full text-ink-2 active:bg-surface-2"
            aria-label="About this app"
            title="About this app"
          >
            <HelpIcon />
          </button>
        </div>
      </header>

      <main className="relative min-h-[30dvh] flex-1" data-tour="map">
        <MapView
          bbox={index.bbox}
          attribution={index.attribution}
          date={date}
          gear={gear}
          cells={cells}
          breaks={index.color_breaks ?? []}
          drift={shownDrift}
          paths={shownPaths}
          windageFactors={windageFactors}
          selectedNets={selectedNets}
          picked={picked}
          layers={layers}
          focus={focus}
          onMapReady={onMapReady}
          onPick={pick}
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex items-start justify-end gap-2">
          {selectedNets.length > 0 && (
            <button type="button" className={floatingBtn} onClick={() => setSelectedNets([])}>
              Drift: {selectedNets.length} item{selectedNets.length === 1 ? '' : 's'} ✕
            </button>
          )}
        </div>
      </main>

      <section
        className="z-[1001] flex min-h-0 flex-col rounded-t-2xl border-t border-line bg-surface shadow-[0_-4px_16px_rgba(0,0,0,0.12)]"
        style={expanded ? { height: '60dvh' } : undefined}
      >
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="flex h-6 w-full shrink-0 items-center justify-center"
          aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={expanded}
        >
          <span className="h-1.5 w-10 rounded-full bg-line" />
        </button>

        {picked && (
          <div className="shrink-0 border-b border-line">
            <DetailCard
              picked={picked}
              date={date}
              windowDays={windowDays}
              onShowDrift={showDrift}
              onClose={() => setPicked(null)}
            />
          </div>
        )}

        <div className="shrink-0 px-4 pb-2" data-tour="date">
          <DateBar
            dates={index.dates}
            value={date}
            today={index.forecast_start.slice(0, 10)}
            totals={index.expected_nets_per_date}
            windowDays={windowDays}
            onChange={setDate}
          />
        </div>

        {expanded ? (
          <SheetTabs
            index={index}
            windowDays={windowDays}
            windageFactors={windageFactors}
            hotspots={hotspots}
            onFocus={focusHotspot}
            layers={layers}
            onToggleLayer={(layer) => setLayers((l) => ({ ...l, [layer]: !l[layer] }))}
          />
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            data-tour="panel"
            className="h-10 shrink-0 border-t border-line text-sm font-medium text-ink-2 active:bg-surface-2"
          >
            Hotspots · Layers · Legend
          </button>
        )}
      </section>

      <nav
        className="z-[1001] flex shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
        data-tour="nav"
        aria-label="Main menu"
      >
        <button
          type="button"
          className={`${navBtn} ${overlay === null || overlay === 'guide' ? 'text-accent' : 'text-ink-2'}`}
          onClick={goHome}
          aria-current={overlay === null ? 'page' : undefined}
        >
          <HomeIcon />
          Home
        </button>
        {NAV.map(({ screen, label, Icon }) => (
          <button
            key={screen}
            type="button"
            className={`${navBtn} ${overlay === screen ? 'text-accent' : 'text-ink-2'}`}
            onClick={() => setOverlay(screen)}
            aria-current={overlay === screen ? 'page' : undefined}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      {overlay === 'guide' && <Guide onClose={closeOverlay} />}
      {NAV.map(
        ({ screen, label, Icon, text }) =>
          overlay === screen && <ComingSoon key={screen} title={label} icon={<Icon />} text={text} onClose={closeOverlay} />,
      )}
    </div>
  )
}
