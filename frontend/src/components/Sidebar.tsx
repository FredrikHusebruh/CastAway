import type { ReactNode } from 'react'
import type { CellFeature, GearProps, IndexInfo } from '../api'
import { formatDateTime, formatNets, formatPercent, gearLabel, ringCenter } from '../format'
import DateSlider from './DateSlider'
import Legend from './Legend'
import Logo from './Logo'
import type { Layers } from './Map'

interface Props {
  index: IndexInfo
  date: string
  windowDays: number
  windageFactors: number[]
  onDateChange: (date: string) => void
  hotspots: CellFeature[]
  onFocus: (latLng: [number, number]) => void
  layers: Layers
  onToggleLayer: (layer: keyof Layers) => void
  nSelected: number
  onClearSelection: () => void
  /** Set when one lost item is in focus: its own beaching chance replaces the regional map. */
  item: { gear: GearProps | undefined; chance: number | null } | null
}

function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-line px-4 py-3">
      {title && <h2 className="text-xs font-medium uppercase tracking-wide text-ink-3">{title}</h2>}
      {children}
    </section>
  )
}

const LAYER_LABELS: Record<keyof Layers, string> = {
  beaching: 'Beaching forecast',
  gear: 'Lost gear',
  paths: 'Drift paths',
  drift: 'Drift likelihood (heat map)',
}

export default function Sidebar(props: Props) {
  const { index } = props
  return (
    <aside className="flex h-full flex-col overflow-y-auto bg-surface text-ink">
      <header className="px-4 pb-3 pt-4">
        <h1>
          <Logo className="h-9 w-auto" />
        </h1>
        <p className="mt-1 text-sm text-ink-2">Where will lost fishing gear wash ashore?</p>
        {index.gear_source === 'mock' && (
          <p className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-900">
            <strong>Mock data:</strong> lost-gear reports are randomly generated for demonstration. Currents and wind
            are real.
          </p>
        )}
      </header>

      <Section>
        <DateSlider
          dates={index.dates}
          value={props.date}
          today={index.forecast_start.slice(0, 10)}
          totals={index.expected_nets_per_date}
          windowDays={props.windowDays}
          itemChance={props.item ? props.item.chance : undefined}
          onChange={props.onDateChange}
        />
      </Section>

      {props.item && (
        <Section title="Selected item">
          <div className="space-y-1 rounded-md bg-surface-2 p-3 text-sm">
            <div className="font-semibold">{props.item.gear ? gearLabel(props.item.gear.gear_type) : 'Lost item'}</div>
            {props.item.gear && (
              <div className="text-ink-2">
                Lost {formatDateTime(props.item.gear.lost_time)} · floats ~
                {Math.round(props.item.gear.float_prob * 100)} %
              </div>
            )}
            <div>
              <span className="text-lg font-semibold">
                {props.item.chance === null ? '…' : formatPercent(props.item.chance)}
              </span>{' '}
              chance it washes ashore in the {props.windowDays} days to this date
            </div>
            <button type="button" onClick={props.onClearSelection} className="text-sm font-medium text-ink underline">
              Show all items
            </button>
          </div>
        </Section>
      )}

      <Section
        title={
          props.item
            ? `Where this item most likely washes ashore · last ${props.windowDays} days`
            : `Most likely to wash ashore · last ${props.windowDays} days`
        }
      >
        {props.hotspots.length === 0 ? (
          <p className="text-sm text-ink-3">No strandings expected in this period.</p>
        ) : (
          <ol className="space-y-1">
            {props.hotspots.map((f, k) => {
              const [lat, lng] = ringCenter(f.geometry.coordinates[0])
              return (
                <li key={f.properties.cell_id}>
                  <button
                    type="button"
                    onClick={() => props.onFocus([lat, lng])}
                    className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="text-ink-2">
                      {k + 1}. {lat.toFixed(3)}°N {lng.toFixed(3)}°E
                    </span>
                    <span className="font-semibold tabular-nums">
                      {props.item ? formatPercent(f.properties.expected_nets) : formatNets(f.properties.expected_nets)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        )}
      </Section>

      <Section title="Layers">
        {(Object.keys(LAYER_LABELS) as (keyof Layers)[]).map((layer) => (
          <label key={layer} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.layers[layer]}
              onChange={() => props.onToggleLayer(layer)}
              className="accent-[var(--accent)]"
            />
            {LAYER_LABELS[layer]}
          </label>
        ))}
        {props.nSelected > 0 ? (
          <button type="button" onClick={props.onClearSelection} className="text-sm text-ink-2 underline">
            Clear drift for {props.nSelected} item{props.nSelected === 1 ? '' : 's'}
          </button>
        ) : (
          <p className="text-xs text-ink-3">Click a lost item or a coast cell to see where it drifts.</p>
        )}
      </Section>

      <Section title="Legend">
        <Legend
          breaks={index.color_breaks ?? []}
          windowDays={props.windowDays}
          windageFactors={props.windageFactors}
          layers={props.layers}
          itemMode={props.item !== null}
        />
      </Section>

      <Section title="How it works">
        <p className="text-sm text-ink-2">
          Reports of lost, unrecovered fishing gear ({index.n_nets} items in this region) are released as{' '}
          {index.particles_per_net} virtual particles each and drifted with ocean currents and wind from MET Norway's
          NorKyst model using OpenDrift. Where particles hit the coast they strand. Each coast cell shows the expected
          number of nets washed ashore in the {props.windowDays} days up to the selected date, weighted by how likely
          each gear type is to float. Selecting an item draws a sample of its particles' paths so far, coloured by how
          strongly the wind pushes them; the optional heat map shows where it is most likely to have floated.
        </p>
        <p className="text-xs text-ink-3">
          Model run {formatDateTime(index.run_timestamp)}. Uncertainty grows with drift time; most lost gear sinks.
        </p>
      </Section>

      <footer className="mt-auto border-t border-line px-4 py-3 text-xs text-ink-3">{index.attribution}</footer>
    </aside>
  )
}
