import { formatDate, formatNets, formatPercent } from '../format'
import { haptic, useTweenedNumber } from '../motion'

interface Props {
  dates: string[]
  value: string
  today: string // YYYY-MM-DD of the forecast start; earlier dates are hindcast, later ones forecast
  total: number // expected nets ashore in the window (during playback blended by the hour)
  windowDays: number
  itemChance?: number | null // item focus: show this item's chance instead of the regional total
  time: number | null // playback time (epoch ms), or null when not playing/paused mid-day
  playing: boolean
  onPlay: () => void
  onPause: () => void
  onChange: (date: string) => void // a date picked with the arrows (leaves playback)
  onScrub: (time: number) => void // the slider dragged to a time (epoch ms, whole hours)
}

const PHASES = {
  hindcast: { label: 'Historikk', className: 'bg-surface-2 text-ink-2' },
  today: { label: 'I dag', className: 'bg-ink text-surface' },
  forecast: { label: 'Prognose', className: 'bg-accent text-white' },
}

const HOUR_MS = 3_600_000

/** Playback clock in the viewer's own time zone, e.g. "fre. 9. okt., 14:30". */
function formatClock(t: number): string {
  const d = new Date(t)
  const day = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

/** Always-visible date control at the top of the bottom sheet, sized for thumbs (44 px targets). */
export default function DateBar({ dates, value, today, total, windowDays, itemChance, time, playing, onPlay, onPause, onChange, onScrub }: Props) {
  const i = Math.max(dates.indexOf(value), 0)
  const phase = PHASES[value < today ? 'hindcast' : value === today ? 'today' : 'forecast']
  const shownTotal = useTweenedNumber(total, playing ? 120 : 450)
  const chance = useTweenedNumber(itemChance ?? 0)
  // the slider runs hour by hour over the whole period (hours since the first date's start); a date on its own
  // (no clock) sits at the end of its day, where its 7-day window ends
  const first = Date.parse(`${dates[0]}T00:00:00Z`)
  const hours = dates.length * 24
  const position = time === null ? (i + 1) * 24 : Math.min(Math.max((time - first) / HOUR_MS, 1), hours)

  const step = (d: number) => {
    haptic()
    onChange(dates[Math.min(Math.max(i + d, 0), dates.length - 1)])
  }
  const btn =
    'grid h-11 min-w-11 place-items-center rounded-full border border-line text-lg active:bg-surface-2 disabled:opacity-40'

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={i === 0 && time === null} aria-label="Forrige dag">
          ‹
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="truncate text-base font-semibold tabular-nums">
              {time === null ? formatDate(value) : formatClock(time)}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors duration-300 ${phase.className}`}>
              {phase.label}
            </span>
          </div>
          <div className="text-xs text-ink-2">
            {itemChance !== undefined ? (
              <>
                <span className="font-semibold tabular-nums text-ink">
                  {itemChance === null ? '…' : formatPercent(chance)}
                </span>{' '}
                sjanse i land på {windowDays} dager
              </>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-ink">{formatNets(shownTotal)}</span> garn i land på{' '}
                {windowDays} dager
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className={btn}
          onClick={() => step(1)}
          disabled={i === dates.length - 1 && time === null}
          aria-label="Neste dag"
        >
          ›
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={`h-9 shrink-0 rounded-full px-3 text-sm font-medium active:opacity-70 ${playing ? 'bg-accent text-white' : 'bg-surface-2'}`}
          onClick={() => {
            haptic()
            if (playing) onPause()
            else onPlay()
          }}
          aria-label={playing ? 'Pause' : 'Spill av time for time'}
          title={playing ? 'Pause' : 'Spill av time for time'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={1}
          max={hours}
          step={playing ? 'any' : 1}
          value={position}
          onChange={(e) => onScrub(first + Math.round(Number(e.target.value)) * HOUR_MS)}
          className="w-full accent-[var(--accent)]"
          aria-label="Prognosetid, time for time"
          aria-valuetext={time === null ? formatDate(value) : formatClock(time)}
        />
      </div>
    </div>
  )
}
