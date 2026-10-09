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
import { CloseIcon, HelpIcon, HomeIcon, LeaderboardIcon, ProfileIcon, ReportIcon } from './components/Icons'
import MapView, { type Layers, type Picked } from './components/Map'
import SheetTabs, { type Hotspot, type HotspotSort, type Tab } from './components/Sheet'
import { distanceKm, ringCenter } from './format'

const MAX_DRIFT_NETS = 25 // matches the API cap per /api/drift request
const N_HOTSPOTS = 5
const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_WINDAGE = [0, 0.01, 0.02, 0.03]

function defaultDate(index: IndexInfo): string {
  const today = index.forecast_start.slice(0, 10)
  return index.dates.includes(today) ? today : index.dates[0]
}

const floatingBtn =
  'pointer-events-auto grid h-11 min-w-11 place-items-center rounded-full bg-surface px-3 text-sm font-medium text-ink shadow-md active:opacity-80'
const navBtn =
  'flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-200 active:bg-surface-2'

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
  const [sheetTab, setSheetTab] = useState<Tab>('Hotspots')
  const [hotspotSort, setHotspotSort] = useState<HotspotSort>('nets')
  const [userPos, setUserPos] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
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

  /** "Nearest me" needs the phone's position; browsers only share it on https or localhost. */
  const sortHotspots = (sort: HotspotSort) => {
    setLocError(null)
    if (sort === 'nets' || userPos) return setHotspotSort(sort)
    if (!window.isSecureContext || !navigator.geolocation) {
      return setLocError('Location only works over https (or on localhost).')
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos([pos.coords.latitude, pos.coords.longitude])
        setHotspotSort('near')
        setLocating(false)
      },
      (err) => {
        setLocError(err.code === err.PERMISSION_DENIED ? 'Location access was denied.' : 'Could not find your location.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }

  const hotspots: Hotspot[] = useMemo(() => {
    const all = (cells?.features ?? []).map((cell) => ({
      cell,
      km: userPos ? distanceKm(userPos, ringCenter(cell.geometry.coordinates[0])) : null,
    }))
    const byNets = (x: Hotspot, y: Hotspot) => y.cell.properties.expected_nets - x.cell.properties.expected_nets
    const byKm = (x: Hotspot, y: Hotspot) => (x.km ?? 0) - (y.km ?? 0)
    return all.sort(hotspotSort === 'near' && userPos ? byKm : byNets).slice(0, N_HOTSPOTS)
  }, [cells, userPos, hotspotSort])

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
            <button
              type="button"
              onClick={() => {
                setPicked(null)
                setSheetTab('About')
                setExpanded(true)
              }}
              className="rounded-md bg-amber-400 px-2 py-1 text-xs font-bold tracking-wide text-amber-950 active:opacity-80"
              title="What does mock data mean?"
            >
              MOCK DATA
            </button>
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
          userPos={userPos}
          onMapReady={onMapReady}
          onPick={pick}
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex items-start justify-end gap-2">
          {selectedNets.length > 0 && (
            <button type="button" className={`${floatingBtn} animate-fade-in`} onClick={() => setSelectedNets([])}>
              Drift: {selectedNets.length} item{selectedNets.length === 1 ? '' : 's'} ✕
            </button>
          )}
        </div>
        {error && (
          // a request after start-up failed (e.g. drift paths); the map keeps working, so just say so
          <div
            role="alert"
            className="absolute inset-x-3 bottom-14 animate-fade-up z-[1000] flex items-center gap-2 rounded-xl bg-red-700 py-2 pl-3 pr-1 text-sm text-white shadow-md"
          >
            <span className="min-w-0 flex-1">Could not load part of the forecast. Check the connection and try again.</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-white/20"
              aria-label="Dismiss error"
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </main>

      <section className="relative z-[1001] -mt-(--sheet-overlap) flex min-h-0 flex-col rounded-t-3xl bg-surface shadow-[0_-6px_20px_rgba(0,0,0,0.14)]">
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="flex h-6 w-full shrink-0 items-center justify-center"
          aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
          aria-expanded={expanded}
        >
          <span className={`h-1.5 rounded-full bg-line transition-all duration-300 ${expanded ? 'w-14' : 'w-10'}`} />
        </button>

        {picked && (
          <div key={picked.kind === 'gear' ? picked.gear.id : picked.cell.properties.cell_id} className="shrink-0 animate-fade-up border-b border-line">
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

        {/* grid-rows 0fr -> 1fr animates the panel open/closed without knowing its height */}
        <div
          className={`grid shrink-0 transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
          inert={!expanded}
        >
          <div className="min-h-0 overflow-hidden">
            {/* 60% of the screen, but always leave the map at least 30% (header + menu + date bar ≈ 14.5rem) */}
            <div className={`flex h-[min(calc(60dvh-7.5rem),calc(70dvh-14.5rem))] flex-col transition-opacity duration-300 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
              <SheetTabs
                index={index}
                windowDays={windowDays}
                windageFactors={windageFactors}
                hotspots={hotspots}
                hotspotSort={hotspotSort}
                onHotspotSort={sortHotspots}
                locating={locating}
                locError={locError}
                onFocus={focusHotspot}
                layers={layers}
                onToggleLayer={(layer) => setLayers((l) => ({ ...l, [layer]: !l[layer] }))}
                nSelected={selectedNets.length}
                onClearSelection={() => setSelectedNets([])}
                tab={sheetTab}
                onTabChange={setSheetTab}
              />
            </div>
          </div>
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            data-tour="panel"
            className="h-10 shrink-0 animate-fade-in border-t border-line text-sm font-medium text-ink-2 active:bg-surface-2"
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
