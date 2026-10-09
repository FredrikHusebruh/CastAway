import type L from 'leaflet'
import { type JSX, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type CellCollection,
  type CoastInfo,
  type DriftResponse,
  type GearCollection,
  type IndexInfo,
  type ItemBeaching,
  API_URL,
  STATIC,
  fetchBeaching,
  fetchCoast,
  fetchDrift,
  fetchGear,
  fetchIndex,
  fetchItemBeaching,
  fetchPaths,
  type ParticlePath,
} from './api'
import DateBar from './components/DateBar'
import DetailCard from './components/DetailCard'
import Guide from './components/Guide'
import Screen from './components/Screen'
import { CloseIcon, HelpIcon, HomeIcon, LeaderboardIcon, ProfileIcon, ReportIcon } from './components/Icons'
import MapView, { type Layers, type Picked } from './components/Map'
import SheetTabs, { type Hotspot, type HotspotSort, type Tab } from './components/Sheet'
import { distanceKm, formatDate, formatUpdated, gearLabel, ringCenter } from './format'
import { useGame } from './game/store'
import { haptic, usePresence, useSheetDrag } from './motion'
import Leaderboard from './screens/Leaderboard'
import Profile from './screens/Profile'
import Report from './screens/Report'

const MAX_DRIFT_NETS = 25 // matches the API cap per /api/drift request
const N_HOTSPOTS = 5
const STALE_AFTER_MS = 24 * 3600 * 1000 // forecasts older than this get an "outdated" warning
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

// Bottom-bar screens other than the map. Reports, points and the leaderboard are stored on this device only
// (game/store.ts); there are no accounts or servers.
type ScreenId = 'report' | 'leaderboard' | 'profile'
const NAV: { screen: ScreenId; label: string; title: string; Icon: () => JSX.Element }[] = [
  { screen: 'report', label: 'Rapportering', title: 'Rapportering', Icon: ReportIcon },
  { screen: 'leaderboard', label: 'Toppliste', title: 'Toppliste', Icon: LeaderboardIcon },
  { screen: 'profile', label: 'Profil', title: 'Min profil', Icon: ProfileIcon },
]

/** Grey outline of the app with a shimmer while the forecast loads. */
function LoadingSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-surface" aria-busy="true" aria-label="Laster prognosen">
      <div className="space-y-1.5 border-b border-line px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="shimmer h-5 w-28 rounded" />
        <div className="shimmer h-3 w-44 rounded" />
      </div>
      <div className="shimmer flex-1" />
      <div className="-mt-5 space-y-3 rounded-t-3xl bg-surface px-4 pb-4 pt-6">
        <div className="flex items-center gap-3">
          <div className="shimmer h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="shimmer mx-auto h-4 w-32 rounded" />
            <div className="shimmer mx-auto h-3 w-40 rounded" />
          </div>
          <div className="shimmer h-11 w-11 rounded-full" />
        </div>
        <div className="shimmer h-2 rounded-full" />
      </div>
      <div className="flex h-14 border-t border-line pb-[env(safe-area-inset-bottom)]">
        {[0, 1, 2, 3].map((k) => (
          <div key={k} className="flex flex-1 flex-col items-center justify-center gap-1">
            <div className="shimmer h-5 w-5 rounded" />
            <div className="shimmer h-2 w-10 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
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
  const [layers, setLayers] = useState<Layers>({ gear: true, beaching: true, paths: true, drift: false, reports: true })
  const [coast, setCoast] = useState<CoastInfo | null>(null)
  const game = useGame()
  const [focus, setFocus] = useState<[number, number] | null>(null)
  // item focus: one lost item whose own beaching chance replaces the regional map (as on desktop)
  const [itemId, setItemId] = useState<string | null>(null)
  const [itemBeaching, setItemBeaching] = useState<ItemBeaching | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [sheetTab, setSheetTab] = useState<Tab>('Hotspots')
  const [hotspotSort, setHotspotSort] = useState<HotspotSort>('nets')
  const [userPos, setUserPos] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<'guide' | ScreenId | null>(null)
  const [outdated, setOutdated] = useState(false) // forecast run older than STALE_AFTER_MS
  const [pending, setPending] = useState(0) // requests in flight, for the loading bar
  const mapRef = useRef<L.Map | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelHeight, setPanelHeight] = useState(0)
  const { dragHeight, dragHandlers } = useSheetDrag(expanded, setExpanded, panelRef)
  // a report card follows the stored report (a moderator decision, "delete all"); rejected or deleted closes it
  const livePicked: Picked | null = useMemo(() => {
    if (picked?.kind !== 'report') return picked
    const r = game.reports.find((x) => x.id === picked.report.id)
    return r && r.status !== 'rejected' ? { kind: 'report', report: r } : null
  }, [picked, game.reports])
  const [shownCard, cardLeaving] = usePresence(livePicked)
  const [shownOverlay, overlayLeaving] = usePresence(overlay)
  const [shownError, errorLeaving] = usePresence(index ? error : null)
  const [shownDriftCount, chipLeaving] = usePresence(selectedNets.length || null)

  /** Counts a request for the loading bar while it is in flight. */
  const track = useCallback(<T,>(request: Promise<T>): Promise<T> => {
    // counted a microtask later so the effects that start requests don't set state synchronously
    void Promise.resolve().then(() => setPending((n) => n + 1))
    return request.finally(() => void Promise.resolve().then(() => setPending((n) => n - 1)))
  }, [])

  // the open panel's height, re-measured when the screen size changes
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPanelHeight(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [index])
  const onMapReady = useCallback((map: L.Map) => {
    mapRef.current = map
  }, [])

  useEffect(() => {
    Promise.all([fetchIndex(), fetchGear()])
      .then(([idx, g]) => {
        setIndex(idx)
        setOutdated(Date.now() - new Date(idx.run_timestamp).getTime() > STALE_AFTER_MS)
        setGear(g)
        setDate(defaultDate(idx))
      })
      .catch((e: Error) => setError(e.message))
    // coast cells for the report checks; older outputs have none (reports are then not checked against the coast)
    fetchCoast()
      .then(setCoast)
      .catch(() => setCoast(null))
  }, [])

  useEffect(() => {
    if (!date) return
    let stale = false
    track(fetchBeaching(date))
      .then((c) => {
        if (stale) return
        setCells(c)
        // a picked cell belongs to one date's 7-day window; drop it when the date changes
        setPicked((p) => (p?.kind === 'cell' ? null : p))
      })
      .catch((e: Error) => !stale && setError(e.message))
    return () => {
      stale = true
    }
  }, [date, track])

  // particle paths and (if shown) the drift heat map for the selected nets, up to the selected date
  useEffect(() => {
    if (!date || selectedNets.length === 0) return
    let stale = false
    track(fetchPaths(selectedNets, date))
      .then((p) => !stale && setPaths(p))
      .catch((e: Error) => !stale && setError(e.message))
    return () => {
      stale = true
    }
  }, [selectedNets, date, track])

  useEffect(() => {
    if (!date || selectedNets.length === 0 || !layers.drift) return
    let stale = false
    track(fetchDrift(selectedNets, date))
      .then((d) => !stale && setDrift(d))
      .catch((e: Error) => !stale && setError(e.message))
    return () => {
      stale = true
    }
  }, [selectedNets, date, layers.drift, track])

  useEffect(() => {
    if (!date || !itemId) return
    let stale = false
    track(fetchItemBeaching(itemId, date))
      .then((b) => !stale && setItemBeaching(b))
      .catch((e: Error) => {
        if (stale) return
        setError(e.message)
        setItemId(null) // back to the regional map rather than an empty one with an endless "…"
      })
    return () => {
      stale = true
    }
  }, [itemId, date, track])

  const showDrift = useCallback((ids: string[]) => {
    setSelectedNets(ids.slice(0, MAX_DRIFT_NETS))
    setLayers((l) => (l.paths || l.drift ? l : { ...l, paths: true }))
    setPicked(null)
    setExpanded(false) // give the map the room to show the paths
  }, [])

  // from a coast-cell card: paths for the items behind it, regional map stays
  const showCellDrift = useCallback(
    (ids: string[]) => {
      setItemId(null)
      showDrift(ids)
    },
    [showDrift],
  )

  // from a lost-item card: only this item's beaching chance, plus its paths
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
    // a coast-cell card from item focus holds that item's chance, not regional expected nets
    setPicked((p) => (p?.kind === 'cell' ? null : p))
  }, [])

  const pick = useCallback((p: Picked | null) => {
    if (p) haptic()
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

  // from a submitted report: back to the map, zoomed in on it, with "Mine funn" shown
  const showReportOnMap = useCallback((latLng: [number, number]) => {
    setOverlay(null)
    setLayers((l) => ({ ...l, reports: true }))
    setFocus(latLng)
    setExpanded(false)
  }, [])
  const mapReports = useMemo(
    () => game.reports.filter((r) => r.kind !== 'delivery' && r.status !== 'rejected'),
    [game.reports],
  )

  /** "Nearest me" needs the phone's position; browsers only share it on https or localhost. */
  const sortHotspots = (sort: HotspotSort) => {
    setLocError(null)
    if (sort === 'nets' || userPos) return setHotspotSort(sort)
    if (!window.isSecureContext || !navigator.geolocation) {
      return setLocError('Posisjon virker bare over https (eller på localhost).')
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPos([pos.coords.latitude, pos.coords.longitude])
        setHotspotSort('near')
        setLocating(false)
      },
      (err) => {
        setLocError(err.code === err.PERMISSION_DENIED ? 'Du har ikke gitt tilgang til posisjonen.' : 'Fant ikke posisjonen din.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    )
  }

  const shownItem = itemBeaching && itemBeaching.id === itemId ? itemBeaching : null
  const shownCells = itemId ? shownItem : cells
  const breaks = useMemo(() => index?.color_breaks ?? [], [index])
  const [shownItemBanner, itemBannerLeaving] = usePresence(itemId)
  // from the banner's (exit-animation-retained) id, so the text stays put while it fades out
  const itemGear = shownItemBanner
    ? gear?.features.find((f) => f.properties.id === shownItemBanner)?.properties
    : undefined

  const hotspots: Hotspot[] = useMemo(() => {
    const all = (shownCells?.features ?? []).map((cell) => ({
      cell,
      km: userPos ? distanceKm(userPos, ringCenter(cell.geometry.coordinates[0])) : null,
    }))
    const byNets = (x: Hotspot, y: Hotspot) => y.cell.properties.expected_nets - x.cell.properties.expected_nets
    const byKm = (x: Hotspot, y: Hotspot) => (x.km ?? 0) - (y.km ?? 0)
    return all.sort(hotspotSort === 'near' && userPos ? byKm : byNets).slice(0, N_HOTSPOTS)
  }, [shownCells, userPos, hotspotSort])

  if (error && !index) {
    return (
      <div className="grid h-dvh place-items-center p-6 text-center">
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-bold">CastAway</h1>
          <p className="text-ink-2">
            Kunne ikke laste prognosen {STATIC ? '(data/)' : `fra ${API_URL || 'serveren'}`}.
          </p>
          <p className="text-sm text-ink-3">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 h-11 rounded-full bg-ink px-5 text-sm font-semibold text-surface"
          >
            Prøv igjen
          </button>
        </div>
      </div>
    )
  }
  if (!index) return <LoadingSkeleton />

  const windowDays = index.beaching_window_days ?? DEFAULT_WINDOW_DAYS
  const windageFactors = index.wind_drift_factors ?? DEFAULT_WINDAGE
  // only show a heat map / paths that belong to the current selection (hides stale/cleared ones)
  const shownDrift = drift && drift.ids.join() === selectedNets.join() ? drift : null
  const shownPaths = paths && paths.ids.join() === selectedNets.join() ? paths.paths : null
  const sheetOpenness = dragHeight === null ? (expanded ? 1 : 0) : Math.min(dragHeight / Math.max(panelHeight, 1), 1)

  return (
    <div className="flex h-dvh flex-col bg-surface text-ink">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight tracking-tight">CastAway</h1>
          <p className="truncate text-xs text-ink-2">
            Oppdatert {formatUpdated(index.run_timestamp)}
            {outdated && <span className="ml-1 font-semibold text-amber-700">· utdatert</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {index.gear_source === 'mock' && (
            <button
              type="button"
              onClick={() => {
                setPicked(null)
                setSheetTab('Om')
                setExpanded(true)
              }}
              className="rounded-md bg-amber-400 px-2 py-1 text-xs font-bold tracking-wide text-amber-950 active:opacity-80"
              title="Hva betyr testdata?"
            >
              TESTDATA
            </button>
          )}
          <button
            type="button"
            onClick={openGuide}
            data-tour="help"
            className="grid h-10 w-10 place-items-center rounded-full text-ink-2 active:bg-surface-2"
            aria-label="Om appen"
            title="Om appen"
          >
            <HelpIcon />
          </button>
        </div>
      </header>

      <main className="relative min-h-[30dvh] flex-1" data-tour="map">
        <MapView
          bbox={index.bbox}
          attribution={index.attribution}
          gear={gear}
          cells={shownCells}
          breaks={breaks}
          drift={shownDrift}
          paths={shownPaths}
          reports={mapReports}
          windageFactors={windageFactors}
          selectedNets={selectedNets}
          picked={livePicked}
          layers={layers}
          focus={focus}
          userPos={userPos}
          onMapReady={onMapReady}
          onPick={pick}
        />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex items-start justify-end gap-2">
          {shownDriftCount && (
            <button
              type="button"
              className={`${floatingBtn} ${chipLeaving ? 'pointer-events-none animate-fade-out' : 'animate-fade-in'}`}
              onClick={clearSelection}
            >
              Drift: {shownDriftCount} redskap ✕
            </button>
          )}
        </div>
        {pending > 0 && (
          <div className="loading-bar absolute inset-x-0 top-0 z-[1000] h-1 overflow-hidden" role="progressbar" aria-label="Laster" />
        )}
        {shownError && (
          // a request after start-up failed (e.g. drift paths); the map keeps working, so just say so
          <div
            role="alert"
            className={`absolute inset-x-3 bottom-14 z-[1000] ${errorLeaving ? 'pointer-events-none animate-fade-down-out' : 'animate-fade-up'} flex items-center gap-2 rounded-xl bg-red-700 py-2 pl-3 pr-1 text-sm text-white shadow-md`}
          >
            <span className="min-w-0 flex-1">Kunne ikke laste en del av prognosen. Sjekk nettet og prøv igjen.</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full active:bg-white/20"
              aria-label="Lukk feilmeldingen"
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </main>

      <section className="relative z-[1001] -mt-(--sheet-overlap) flex min-h-0 flex-col rounded-t-3xl bg-surface shadow-[0_-6px_20px_rgba(0,0,0,0.14)]">
        <button
          type="button"
          onClick={() => {
            haptic()
            setExpanded((x) => !x)
          }}
          {...dragHandlers}
          className="flex h-7 w-full shrink-0 touch-none items-center justify-center active:scale-100"
          aria-label={expanded ? 'Lukk panelet' : 'Åpne panelet'}
          aria-expanded={expanded}
        >
          <span className="h-1.5 rounded-full bg-line transition-[width] duration-300" style={{ width: 40 + 16 * sheetOpenness }} />
        </button>

        {shownItemBanner && (
          <div
            className={`mx-3 mb-2 flex shrink-0 items-center gap-3 rounded-2xl bg-surface-2 py-2 pl-3 pr-2 text-sm ${itemBannerLeaving ? 'pointer-events-none animate-fade-out' : 'animate-fade-up'}`}
            role="status"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">
                {itemGear ? gearLabel(itemGear.gear_type) : 'Tapt redskap'}
                <span className="font-normal text-ink-3"> · bare dette</span>
              </div>
              {itemGear && (
                <div className="truncate text-xs text-ink-3">
                  Mistet {formatDate(itemGear.lost_time.slice(0, 10))} · flyter ca. {Math.round(itemGear.float_prob * 100)} %
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="h-9 shrink-0 rounded-full bg-surface px-3 text-xs font-semibold text-ink shadow-sm"
            >
              Vis alle
            </button>
          </div>
        )}

        {shownCard && (
          <div
            key={
              shownCard.kind === 'gear'
                ? shownCard.gear.id
                : shownCard.kind === 'report'
                  ? shownCard.report.id
                  : shownCard.cell.properties.cell_id
            }
            className={`shrink-0 border-b border-line ${cardLeaving ? 'pointer-events-none animate-fade-down-out' : 'animate-fade-up'}`}
          >
            <DetailCard
              picked={shownCard}
              date={date}
              windowDays={windowDays}
              mode={itemId ? 'item' : 'region'}
              onShowDrift={showCellDrift}
              onShowItem={showItem}
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
            itemChance={itemId ? (shownItem?.chance_total ?? null) : undefined}
            onChange={setDate}
          />
        </div>

        {/* follows the finger while dragging, otherwise animates between closed (0) and the open height */}
        <div
          className={`shrink-0 overflow-hidden ${dragHeight === null ? 'transition-[height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]' : ''}`}
          style={{ height: dragHeight ?? (expanded ? panelHeight : 0) }}
          inert={!expanded}
        >
          <div>
            {/* 60% of the screen, but always leave the map at least 30% (header + menu + date bar ≈ 14.5rem) */}
            <div
              ref={panelRef}
              className={`flex h-[min(calc(60dvh-7.5rem),calc(70dvh-14.5rem))] flex-col ${dragHeight === null ? 'transition-opacity duration-300' : ''}`}
              style={{ opacity: sheetOpenness }}
            >
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
                onClearSelection={clearSelection}
                itemMode={itemId !== null}
                tab={sheetTab}
                onTabChange={setSheetTab}
              />
            </div>
          </div>
        </div>
        {!expanded && (
          <button
            type="button"
            onClick={() => {
              haptic()
              setExpanded(true)
            }}
            {...dragHandlers}
            data-tour="panel"
            className="h-10 shrink-0 animate-fade-in touch-none border-t border-line text-sm font-medium text-ink-2 active:bg-surface-2"
          >
            Hotspots · Kartlag · Forklaring <span aria-hidden="true">⌃</span>
          </button>
        )}
      </section>

      <nav
        className="z-[1001] flex shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
        data-tour="nav"
        aria-label="Hovedmeny"
      >
        <button
          type="button"
          className={`${navBtn} ${overlay === null || overlay === 'guide' ? 'text-accent' : 'text-ink-2'}`}
          onClick={() => {
            haptic()
            goHome()
          }}
          aria-current={overlay === null ? 'page' : undefined}
        >
          <HomeIcon />
          Hjem
        </button>
        {NAV.map(({ screen, label, Icon }) => (
          <button
            key={screen}
            type="button"
            className={`${navBtn} ${overlay === screen ? 'text-accent' : 'text-ink-2'}`}
            onClick={() => {
              haptic()
              setOverlay(screen)
            }}
            aria-current={overlay === screen ? 'page' : undefined}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>

      {shownOverlay === 'guide' && <Guide onClose={closeOverlay} leaving={overlayLeaving} />}
      {NAV.map(
        ({ screen, title, Icon }) =>
          shownOverlay === screen && (
            <Screen key={screen} title={title} icon={<Icon />} onClose={closeOverlay} leaving={overlayLeaving}>
              {screen === 'report' && (
                <Report game={game} index={index} gear={gear} coast={coast} onShowOnMap={showReportOnMap} />
              )}
              {screen === 'leaderboard' && <Leaderboard game={game} />}
              {screen === 'profile' && <Profile game={game} />}
            </Screen>
          ),
      )}
    </div>
  )
}
