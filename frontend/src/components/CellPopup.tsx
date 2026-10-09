import type { CellProps } from '../api'
import { formatNets, formatPercent } from '../format'
import type { BeachingMode } from './Map'

interface Props {
  cell: CellProps
  date: string
  windowDays: number
  mode: BeachingMode
  onShowDrift: (netIds: string[]) => void
}

export default function CellPopup({ cell, date, windowDays, mode, onShowDrift }: Props) {
  if (mode === 'item') {
    return (
      <div className="min-w-44 space-y-1 text-sm">
        <div className="text-xs text-stone-500">
          Coast cell · {windowDays} days to {date}
        </div>
        <div>
          <span className="text-lg font-semibold">{formatPercent(cell.expected_nets)}</span> chance this item washes
          ashore here
        </div>
        <div className="text-stone-600">{cell.particle_count} of its particles stranded here</div>
      </div>
    )
  }
  return (
    <div className="min-w-44 space-y-1 text-sm">
      <div className="text-xs text-stone-500">
        Coast cell · {windowDays} days to {date}
      </div>
      <div>
        <span className="text-lg font-semibold">{formatNets(cell.expected_nets)}</span> expected nets
      </div>
      <div className="text-stone-600">
        from {cell.n_nets} lost item{cell.n_nets === 1 ? '' : 's'} · {cell.particle_count} particles
      </div>
      <button
        type="button"
        className="mt-1 text-sm font-medium text-[#4a3aa7] underline underline-offset-2 hover:no-underline"
        onClick={() => onShowDrift(cell.contributing_net_ids)}
      >
        Show where these drifted
      </button>
    </div>
  )
}
