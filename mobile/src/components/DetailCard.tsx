import { directionsUrl, formatDate, formatDateTime, formatNets, formatPercent, gearLabel, ringCenter } from '../format'
import { reportTitle } from '../game/labels'
import { type Report, linesTotal } from '../game/rules'
import { usePhoto } from '../game/store'
import type { BeachingMode, Picked } from './Map'
import { StatusChip } from './Points'

interface Props {
  picked: Picked
  date: string
  windowDays: number
  mode: BeachingMode // 'item': a coast cell shows the focused item's chance, not expected nets
  onShowDrift: (netIds: string[]) => void
  onShowItem: (netId: string) => void
  onClose: () => void
}

const kicker = 'text-xs font-medium uppercase tracking-wide text-ink-3'
const action = 'mt-2 h-11 w-full rounded-xl bg-[#4a3aa7] text-sm font-semibold text-white active:opacity-80'

function DirectionsLink({ at, wide }: { at: [number, number]; wide?: boolean }) {
  return (
    <a
      href={directionsUrl(at)}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-2 grid h-11 place-items-center rounded-xl border border-line text-sm font-semibold text-ink active:bg-surface-2 ${
        wide ? '' : 'shrink-0 px-4'
      }`}
    >
      Veibeskrivelse
    </a>
  )
}

function ReportCard({ report }: { report: Report }) {
  const url = usePhoto(report.photoId)
  return (
    <div className="flex gap-3">
      {url && <img src={url} alt="Bildet fra rapporten" className="h-20 w-20 shrink-0 rounded-xl object-cover" />}
      <div className="min-w-0 space-y-0.5">
        <div className={kicker}>Mitt funn</div>
        <div className="font-semibold">{reportTitle(report)}</div>
        <div className="text-ink-2">{formatDateTime(report.time)}</div>
        <div className="flex items-center gap-2 text-ink-2">
          {linesTotal(report.lines)} poeng <StatusChip status={report.status} />
        </div>
      </div>
    </div>
  )
}

/** Replaces the desktop Leaflet popups: details of the tapped gear item, coast cell or own report. */
export default function DetailCard({ picked, date, windowDays, mode, onShowDrift, onShowItem, onClose }: Props) {
  return (
    <div className="relative space-y-1 px-4 py-3 text-sm">
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full text-xl text-ink-3 active:bg-surface-2"
        aria-label="Lukk"
      >
        ×
      </button>
      {picked.kind === 'report' ? (
        <ReportCard report={picked.report} />
      ) : picked.kind === 'gear' ? (
        <>
          <div className={kicker}>Tapt redskap</div>
          <div className="text-lg font-semibold">{gearLabel(picked.gear.gear_type)}</div>
          <div className="text-ink-2">Mistet {formatDateTime(picked.gear.lost_time)}</div>
          <div className="text-ink-2">Flyter: ca. {Math.round(picked.gear.float_prob * 100)} % sjanse</div>
          <button type="button" className={action} onClick={() => onShowItem(picked.gear.id)}>
            Vis hvor det driver i land
          </button>
        </>
      ) : mode === 'item' ? (
        <>
          <div className={kicker}>
            Kyststrekning · {windowDays} dager til {formatDate(date)}
          </div>
          <div>
            <span className="text-2xl font-semibold">{formatPercent(picked.cell.properties.expected_nets)}</span> sjanse
            for at dette redskapet driver i land her
          </div>
          <div className="text-ink-2">{picked.cell.properties.particle_count} av partiklene strandet her</div>
          <DirectionsLink at={ringCenter(picked.cell.geometry.coordinates[0])} wide />
        </>
      ) : (
        <>
          <div className={kicker}>
            Kyststrekning · {windowDays} dager til {formatDate(date)}
          </div>
          <div>
            <span className="text-2xl font-semibold">{formatNets(picked.cell.properties.expected_nets)}</span> forventede
            garn
          </div>
          <div className="text-ink-2">
            fra {picked.cell.properties.n_nets} tapt{picked.cell.properties.n_nets === 1 ? '' : 'e'} redskap ·{' '}
            {picked.cell.properties.particle_count} partikler
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${action} flex-1`}
              onClick={() => onShowDrift(picked.cell.properties.contributing_net_ids)}
            >
              Vis hvor disse drev
            </button>
            <DirectionsLink at={ringCenter(picked.cell.geometry.coordinates[0])} />
          </div>
        </>
      )}
    </div>
  )
}
