import type { CellFeature, IndexInfo } from '../api'
import { formatDateTime, formatNets, ringCenter } from '../format'
import Legend from './Legend'
import type { Layers } from './Map'

const TABS = ['Hotspots', 'Layers', 'Legend', 'About'] as const
export type Tab = (typeof TABS)[number]

const LAYER_LABELS: Record<keyof Layers, string> = {
  beaching: 'Beaching forecast',
  gear: 'Lost gear',
  paths: 'Drift paths',
  drift: 'Drift likelihood (heat map)',
}

interface Props {
  index: IndexInfo
  windowDays: number
  windageFactors: number[]
  hotspots: CellFeature[]
  onFocus: (latLng: [number, number]) => void
  layers: Layers
  onToggleLayer: (layer: keyof Layers) => void
  nSelected: number
  onClearSelection: () => void
  tab: Tab
  onTabChange: (tab: Tab) => void
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
            className={`h-11 flex-1 border-b-2 text-sm font-medium ${
              tab === t ? 'border-accent text-ink' : 'border-transparent text-ink-3'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {tab === 'Hotspots' &&
          (props.hotspots.length === 0 ? (
            <p className="text-sm text-ink-3">No strandings expected in this period.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-3">Most likely to wash ashore · last {props.windowDays} days</p>
              <ol className="divide-y divide-line">
                {props.hotspots.map((f, k) => {
                  const [lat, lng] = ringCenter(f.geometry.coordinates[0])
                  return (
                    <li key={f.properties.cell_id}>
                      <button
                        type="button"
                        onClick={() => props.onFocus([lat, lng])}
                        className="flex min-h-12 w-full items-center justify-between gap-2 text-left text-sm active:bg-surface-2"
                      >
                        <span className="text-ink-2">
                          {k + 1}. {lat.toFixed(3)}°N {lng.toFixed(3)}°E
                        </span>
                        <span className="font-semibold tabular-nums">{formatNets(f.properties.expected_nets)} nets</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          ))}

        {tab === 'Layers' && (
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
        {tab === 'Layers' &&
          (props.nSelected > 0 ? (
            <button
              type="button"
              onClick={props.onClearSelection}
              className="mt-3 h-11 w-full rounded-xl border border-line text-sm font-medium text-ink-2 active:bg-surface-2"
            >
              Clear drift for {props.nSelected} item{props.nSelected === 1 ? '' : 's'}
            </button>
          ) : (
            <p className="mt-3 text-xs text-ink-3">Tap a lost item or a coast cell to see where it drifts.</p>
          ))}

        {tab === 'Legend' && (
          <Legend
            breaks={index.color_breaks ?? []}
            windowDays={props.windowDays}
            windageFactors={props.windageFactors}
            layers={props.layers}
          />
        )}

        {tab === 'About' && (
          <div className="space-y-2">
            {index.gear_source === 'mock' && (
              <p className="rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900">
                <strong>Mock data:</strong> lost-gear reports are randomly generated for demonstration. Currents and
                wind are real.
              </p>
            )}
            <p className="text-sm text-ink-2">
              Reports of lost, unrecovered fishing gear ({index.n_nets} items in this region) are released as{' '}
              {index.particles_per_net} virtual particles each and drifted with ocean currents and wind from MET
              Norway's NorKyst model using OpenDrift. Where particles hit the coast they strand. Each coast cell shows
              the expected number of nets washed ashore in the {props.windowDays} days up to the selected date,
              weighted by how likely each gear type is to float. Tap an item or a coast cell to see where it drifts.
            </p>
            <p className="text-xs text-ink-3">
              Model run {formatDateTime(index.run_timestamp)}. Uncertainty grows with drift time; most lost gear sinks.
            </p>
            <p className="text-xs text-ink-3">{index.attribution}</p>
          </div>
        )}
      </div>
    </div>
  )
}
