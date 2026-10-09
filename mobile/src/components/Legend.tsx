import {
  DRIFT_RAMP,
  GEAR_COLOR,
  RAMP,
  RAMP_OPACITY,
  SELECTED_COLOR,
  STRANDED_COLOR,
  beachingRange,
  formatNets,
  formatPercent,
  windageColor,
} from '../format'
import type { Layers } from './Map'

/** CSS gradient through hex stops, optionally with per-stop opacity (matches the map rasters). */
function gradient(stops: readonly string[], alphas?: readonly number[]): string {
  const parts = stops.map((c, k) => {
    const a = alphas ? Math.round(alphas[k] * 255).toString(16).padStart(2, '0') : ''
    return `${c}${a}`
  })
  return `linear-gradient(to right, ${parts.join(', ')})`
}

const heading = 'text-xs font-medium uppercase tracking-wide text-ink-3'

interface Props {
  breaks: number[]
  windowDays: number
  windageFactors: number[]
  layers: Layers
  itemMode: boolean
}

export default function Legend({ breaks, windowDays, windageFactors, layers, itemMode }: Props) {
  const [lo, hi] = beachingRange(breaks)
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <div className={heading}>
          {itemMode
            ? `Chance this item washes ashore per ~1 km, ${windowDays} days`
            : `Expected nets per ~1 km of coast, ${windowDays} days`}
        </div>
        <div className="h-3 rounded-sm" style={{ background: gradient(RAMP, RAMP_OPACITY) }} />
        <div className="flex justify-between text-xs text-ink-3">
          <span>≤ {itemMode ? formatPercent(lo) : formatNets(lo)}</span>
          <span>log scale</span>
          <span>≥ {itemMode ? formatPercent(hi) : formatNets(hi)}</span>
        </div>
      </div>
      {layers.paths && (
        <div className="space-y-1">
          <div className={heading}>Particle paths · wind push (windage)</div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {windageFactors.map((f) => (
              <li key={f} className="flex items-center gap-2 text-ink-2">
                <span className="h-0.5 w-5" style={{ background: windageColor(f, windageFactors) }} />
                {Math.round(f * 100)}%{f === 0 ? ' (current only)' : ''}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 text-ink-2">
            <span className="h-2 w-2" style={{ background: STRANDED_COLOR }} /> {/* square, as on the map */}
            Washed ashore
          </div>
        </div>
      )}
      {layers.drift && (
        <div className="space-y-1">
          <div className={heading}>Where selected items drift</div>
          <div className="h-3 rounded-sm" style={{ background: gradient(DRIFT_RAMP) }} />
          <div className="flex justify-between text-xs text-ink-3">
            <span>Less likely</span>
            <span>More likely</span>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white" style={{ background: GEAR_COLOR }} />
          Lost gear
        </span>
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full ring-2 ring-white" style={{ background: SELECTED_COLOR }} />
          Selected
        </span>
      </div>
    </div>
  )
}
