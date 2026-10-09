import type { CellFeature, IndexInfo } from '../api'
import { formatDateTime, formatKm, formatNets, formatPercent, ringCenter } from '../format'
import { usePlaceName } from '../places'
import Legend from './Legend'
import type { Layers } from './Map'

const TABS = ['Hotspots', 'Kartlag', 'Forklaring', 'Om'] as const
export type Tab = (typeof TABS)[number]
export type HotspotSort = 'nets' | 'near'
export interface Hotspot {
  cell: CellFeature
  km: number | null // distance from the user, once their location is known
}

const SORTS: { sort: HotspotSort; label: string }[] = [
  { sort: 'nets', label: 'Flest garn' },
  { sort: 'near', label: 'Nærmest meg' },
]

const LAYER_LABELS: Record<keyof Layers, string> = {
  beaching: 'Prognose for stranding',
  gear: 'Tapte redskap',
  paths: 'Driftsbaner',
  drift: 'Hvor det driver (varmekart)',
  reports: 'Mine funn',
}

interface Props {
  index: IndexInfo
  windowDays: number
  windageFactors: number[]
  hotspots: Hotspot[]
  hotspotSort: HotspotSort
  onHotspotSort: (sort: HotspotSort) => void
  locating: boolean
  locError: string | null
  onFocus: (latLng: [number, number]) => void
  layers: Layers
  onToggleLayer: (layer: keyof Layers) => void
  nSelected: number
  onClearSelection: () => void
  itemMode: boolean // one lost item in focus: values are its chance (%), not expected nets
  tab: Tab
  onTabChange: (tab: Tab) => void
}

/** A coast spot by name ("Kvalvika, Vardø"), with the coordinates as a fallback while loading or offline. */
function PlaceLabel({ lat, lng }: { lat: number; lng: number }) {
  const name = usePlaceName(lat, lng)
  const coords = `${lat.toFixed(3)}°N ${lng.toFixed(3)}°Ø`
  if (!name) return <span className={name === undefined ? 'text-ink-3' : ''}>{coords}</span>
  return (
    <span title={coords}>
      <span className="font-medium text-ink">{name}</span>
    </span>
  )
}

/** The expandable part of the bottom sheet: everything the desktop sidebar shows below the date slider. */
export default function SheetTabs(props: Props) {
  const { index, tab } = props
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex gap-1 border-b border-line px-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => props.onTabChange(t)}
            className={`h-11 flex-1 border-b-2 text-sm font-medium transition-colors duration-200 ${
              tab === t ? 'border-accent text-ink' : 'border-transparent text-ink-3'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div key={tab} className="min-h-0 flex-1 animate-fade-in overflow-y-auto overscroll-contain px-4 py-3">
        {tab === 'Hotspots' && (
          <>
            <div role="radiogroup" aria-label="Sorter hotspots" className="mb-2 flex rounded-full bg-surface-2 p-1">
              {SORTS.map(({ sort, label }) => (
                <button
                  key={sort}
                  type="button"
                  role="radio"
                  aria-checked={props.hotspotSort === sort}
                  onClick={() => props.onHotspotSort(sort)}
                  className={`h-9 flex-1 rounded-full text-sm font-medium transition-colors duration-200 ${
                    props.hotspotSort === sort ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'
                  }`}
                >
                  {sort === 'near' && props.locating ? 'Finner deg …' : label}
                </button>
              ))}
            </div>
            {props.locError && <p className="mb-2 text-xs text-red-700">{props.locError}</p>}
            {props.hotspots.length === 0 ? (
              <p className="text-sm text-ink-3">Ingen strandinger ventet i denne perioden.</p>
            ) : (
              <>
                <p className="mb-1 text-xs text-ink-3">
                  {props.hotspotSort === 'near'
                    ? 'Nærmest deg'
                    : props.itemMode
                      ? 'Hvor dette redskapet mest sannsynlig driver i land'
                      : 'Mest sannsynlig i land'}{' '}
                  · siste {props.windowDays} dager
                </p>
                <ol className="divide-y divide-line">
                  {props.hotspots.map(({ cell: f, km }, k) => {
                    const [lat, lng] = ringCenter(f.geometry.coordinates[0])
                    return (
                      <li key={f.properties.cell_id} className="animate-fade-in">
                        <button
                          type="button"
                          onClick={() => props.onFocus([lat, lng])}
                          className="flex min-h-12 w-full items-center justify-between gap-2 text-left text-sm active:bg-surface-2"
                        >
                          <span className="min-w-0 text-ink-2">
                            {k + 1}. <PlaceLabel lat={lat} lng={lng} />
                            {km !== null && <span className="block text-xs text-ink-3">{formatKm(km)} unna</span>}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">
                            {props.itemMode
                              ? formatPercent(f.properties.expected_nets)
                              : `${formatNets(f.properties.expected_nets)} garn`}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </>
            )}
          </>
        )}

        {tab === 'Kartlag' && (
          <ul className="divide-y divide-line">
            {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((layer) => (
              <li key={layer}>
                <label className="flex min-h-12 items-center justify-between gap-3 text-sm">
                  {LAYER_LABELS[layer]}
                  <input
                    type="checkbox"
                    checked={props.layers[layer]}
                    onChange={() => props.onToggleLayer(layer)}
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
        {tab === 'Kartlag' &&
          (props.nSelected > 0 ? (
            <button
              type="button"
              onClick={props.onClearSelection}
              className="mt-3 h-11 w-full rounded-xl border border-line text-sm font-medium text-ink-2 active:bg-surface-2"
            >
              Fjern drift for {props.nSelected} redskap
            </button>
          ) : (
            <p className="mt-3 text-xs text-ink-3">Trykk på et tapt redskap eller kysten for å se hvor det driver.</p>
          ))}

        {tab === 'Forklaring' && (
          <Legend
            breaks={index.color_breaks ?? []}
            windowDays={props.windowDays}
            windageFactors={props.windageFactors}
            layers={props.layers}
            itemMode={props.itemMode}
          />
        )}

        {tab === 'Om' && (
          <div className="space-y-2">
            {index.gear_source === 'mock' && (
              <p className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900">
                <strong>Testdata:</strong> meldingene om tapte redskap er tilfeldig generert for demonstrasjon. Strøm
                og vind er ekte.
              </p>
            )}
            <p className="text-sm text-ink-2">
              Meldte tapte fiskeredskap som ikke er tatt opp ({index.n_nets} i dette området) slippes ut som{' '}
              {index.particles_per_net} virtuelle partikler hver og driver med havstrøm og vind fra
              Meteorologisk institutts NorKyst-modell i OpenDrift. Der partiklene treffer kysten, strander de. Hver
              kyststrekning viser hvor mange garn som ventes å drive i land de {props.windowDays} dagene fram til valgt
              dato, vektet etter hvor sannsynlig det er at redskapstypen flyter. Trykk på et redskap eller kysten for å
              se hvor det driver.
            </p>
            <p className="text-xs text-ink-3">
              Modellkjøring {formatDateTime(index.run_timestamp)}. Usikkerheten øker med drifttiden; det meste av tapt
              redskap synker.
            </p>
            <p className="text-xs text-ink-3">{index.attribution}</p>
          </div>
        )}
      </div>
    </div>
  )
}
