// Small pieces shared by the report screens, the profile and the map's report card.
import { type PointLine, type Status, linesTotal } from '../game/rules'

const STATUS: Record<Status, { label: string; className: string }> = {
  approved: { label: 'Godkjent', className: 'bg-emerald-100 text-emerald-900' },
  pending: { label: 'Foreløpig', className: 'bg-amber-100 text-amber-900' },
  rejected: { label: 'Avvist', className: 'bg-red-100 text-red-900' },
}

export function StatusChip({ status }: { status: Status }) {
  const s = STATUS[status]
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.className}`}>{s.label}</span>
}

/** The point lines of a report, with the total. */
export function PointLines({ lines }: { lines: PointLine[] }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {lines.map((l) => (
        <li key={l.label} className="flex justify-between gap-3 py-1.5">
          <span className="text-ink-2">{l.label}</span>
          <span className="shrink-0 font-semibold tabular-nums">{l.points > 0 ? `+${l.points}` : l.points}</span>
        </li>
      ))}
      <li className="flex justify-between gap-3 py-1.5 font-semibold">
        <span>Sum</span>
        <span className="tabular-nums">{linesTotal(lines)} poeng</span>
      </li>
    </ul>
  )
}
