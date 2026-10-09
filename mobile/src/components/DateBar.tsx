import { useEffect, useState } from 'react'
import { formatDate, formatNets, formatPercent } from '../format'
import { haptic, useTweenedNumber } from '../motion'

interface Props {
  dates: string[]
  value: string
  today: string // YYYY-MM-DD of the forecast start; earlier dates are hindcast, later ones forecast
  totals: Record<string, number>
  windowDays: number
  itemChance?: number | null // item focus: show this item's chance instead of the regional total
  onChange: (date: string) => void
}

const PLAY_INTERVAL_MS = 1200

const PHASES = {
  hindcast: { label: 'Historikk', className: 'bg-surface-2 text-ink-2' },
  today: { label: 'I dag', className: 'bg-ink text-surface' },
  forecast: { label: 'Prognose', className: 'bg-accent text-white' },
}

/** Always-visible date control at the top of the bottom sheet, sized for thumbs (44 px targets). */
export default function DateBar({ dates, value, today, totals, windowDays, itemChance, onChange }: Props) {
  const [playing, setPlaying] = useState(false)
  const i = Math.max(dates.indexOf(value), 0)
  const phase = PHASES[value < today ? 'hindcast' : value === today ? 'today' : 'forecast']
  const total = useTweenedNumber(totals[value] ?? 0)
  const chance = useTweenedNumber(itemChance ?? 0)

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => onChange(dates[(i + 1) % dates.length]), PLAY_INTERVAL_MS)
    return () => clearTimeout(t)
  }, [playing, i, dates, onChange])

  const step = (d: number) => {
    haptic()
    onChange(dates[Math.min(Math.max(i + d, 0), dates.length - 1)])
  }
  const btn =
    'grid h-11 min-w-11 place-items-center rounded-full border border-line text-lg active:bg-surface-2 disabled:opacity-40'

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={i === 0} aria-label="Forrige dag">
          ‹
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="truncate text-base font-semibold">{formatDate(value)}</span>
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
                <span className="font-semibold tabular-nums text-ink">{formatNets(total)}</span> garn i land på{' '}
                {windowDays} dager
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className={btn}
          onClick={() => step(1)}
          disabled={i === dates.length - 1}
          aria-label="Neste dag"
        >
          ›
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="h-9 shrink-0 rounded-full bg-surface-2 px-3 text-sm font-medium active:opacity-70"
          onClick={() => {
            haptic()
            setPlaying((p) => !p)
          }}
          aria-label={playing ? 'Pause' : 'Spill av datoene'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={dates.length - 1}
          value={i}
          onChange={(e) => onChange(dates[Number(e.target.value)])}
          className="w-full accent-[var(--accent)]"
          aria-label="Prognosedato"
        />
      </div>
    </div>
  )
}
