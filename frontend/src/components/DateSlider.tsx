import { useEffect, useState } from 'react'
import { formatDate, formatNets } from '../format'

interface Props {
  dates: string[]
  value: string
  today: string // YYYY-MM-DD of the forecast start; earlier dates are hindcast, later ones forecast
  totals: Record<string, number>
  windowDays: number
  onChange: (date: string) => void
}

const PLAY_INTERVAL_MS = 1200

const PHASES = {
  hindcast: { label: 'Hindcast', className: 'bg-surface-2 text-ink-2' },
  today: { label: 'Today', className: 'bg-ink text-surface' },
  forecast: { label: 'Forecast', className: 'bg-accent text-white' },
}

export default function DateSlider({ dates, value, today, totals, windowDays, onChange }: Props) {
  const [playing, setPlaying] = useState(false)
  const i = Math.max(dates.indexOf(value), 0)
  const phase = PHASES[value < today ? 'hindcast' : value === today ? 'today' : 'forecast']

  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => onChange(dates[(i + 1) % dates.length]), PLAY_INTERVAL_MS)
    return () => clearTimeout(t)
  }, [playing, i, dates, onChange])

  const step = (d: number) => onChange(dates[Math.min(Math.max(i + d, 0), dates.length - 1)])
  const btn = 'rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-2 disabled:opacity-40'

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-lg font-semibold">{formatDate(value)}</div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${phase.className}`}>{phase.label}</span>
      </div>
      <input
        type="range"
        min={0}
        max={dates.length - 1}
        value={i}
        onChange={(e) => onChange(dates[Number(e.target.value)])}
        className="w-full accent-[var(--accent)]"
        aria-label="Forecast date"
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          <button type="button" className={btn} onClick={() => step(-1)} disabled={i === 0} aria-label="Previous day">
            ‹
          </button>
          <button type="button" className={btn} onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => step(1)}
            disabled={i === dates.length - 1}
            aria-label="Next day"
          >
            ›
          </button>
        </div>
        <div className="text-sm text-ink-2">
          <span className="font-semibold text-ink">{formatNets(totals[value] ?? 0)}</span> nets ashore in{' '}
          {windowDays} days
        </div>
      </div>
    </div>
  )
}
