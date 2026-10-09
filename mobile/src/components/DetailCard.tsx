import { formatDateTime, formatNets, gearLabel } from '../format'
import type { Picked } from './Map'

interface Props {
  picked: Picked
  date: string
  windowDays: number
  onShowDrift: (netIds: string[]) => void
  onClose: () => void
}

/** Replaces the desktop Leaflet popups: details of the tapped gear item or coast cell. */
export default function DetailCard({ picked, date, windowDays, onShowDrift, onClose }: Props) {
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
          <button type="button" className={action} onClick={() => onShowDrift([picked.gear.id])}>
            Show where it drifts
          </button>
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
          <button
            type="button"
            className={action}
            onClick={() => onShowDrift(picked.cell.properties.contributing_net_ids)}
          >
            Show where these drifted
          </button>
        </>
      )}
    </div>
  )
}
