import { directionsUrl, formatDateTime, formatNets, formatPercent, gearLabel, ringCenter } from '../format'
import type { BeachingMode, Picked } from './Map'

interface Props {
  picked: Picked
  date: string
  windowDays: number
  mode: BeachingMode // 'item': a coast cell shows the focused item's chance, not expected nets
  onShowDrift: (netIds: string[]) => void
  onShowItem: (netId: string) => void
  onClose: () => void
}

/** Replaces the desktop Leaflet popups: details of the tapped gear item or coast cell. */
export default function DetailCard({ picked, date, windowDays, mode, onShowDrift, onShowItem, onClose }: Props) {
  const action =
    'mt-2 h-11 w-full rounded-xl bg-[#4a3aa7] text-sm font-semibold text-white active:opacity-80'
  return (
    <div className="relative space-y-1 px-4 py-3 text-sm">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full text-xl text-ink-3 active:bg-surface-2"
        aria-label="Close"
      >
        ×
      </button>
      {picked.kind === 'gear' ? (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-3">Lost gear</div>
          <div className="text-lg font-semibold">{gearLabel(picked.gear.gear_type)}</div>
          <div className="text-ink-2">Lost {formatDateTime(picked.gear.lost_time)}</div>
          <div className="text-ink-2">Floats: ~{Math.round(picked.gear.float_prob * 100)}% chance</div>
          <button type="button" className={action} onClick={() => onShowItem(picked.gear.id)}>
            Show where it washes ashore
          </button>
        </>
      ) : mode === 'item' ? (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Coast cell · {windowDays} days to {date}
          </div>
          <div>
            <span className="text-2xl font-semibold">{formatPercent(picked.cell.properties.expected_nets)}</span> chance
            this item washes ashore here
          </div>
          <div className="text-ink-2">{picked.cell.properties.particle_count} of its particles stranded here</div>
          <a
            href={directionsUrl(ringCenter(picked.cell.geometry.coordinates[0]))}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 grid h-11 place-items-center rounded-xl border border-line text-sm font-semibold text-ink active:bg-surface-2"
          >
            Directions
          </a>
        </>
      ) : (
        <>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-3">
            Coast cell · {windowDays} days to {date}
          </div>
          <div>
            <span className="text-2xl font-semibold">{formatNets(picked.cell.properties.expected_nets)}</span> expected
            nets
          </div>
          <div className="text-ink-2">
            from {picked.cell.properties.n_nets} lost item{picked.cell.properties.n_nets === 1 ? '' : 's'} ·{' '}
            {picked.cell.properties.particle_count} particles
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${action} flex-1`}
              onClick={() => onShowDrift(picked.cell.properties.contributing_net_ids)}
            >
              Show where these drifted
            </button>
            <a
              href={directionsUrl(ringCenter(picked.cell.geometry.coordinates[0]))}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 grid h-11 shrink-0 place-items-center rounded-xl border border-line px-4 text-sm font-semibold text-ink active:bg-surface-2"
            >
              Directions
            </a>
          </div>
        </>
      )}
    </div>
  )
}
