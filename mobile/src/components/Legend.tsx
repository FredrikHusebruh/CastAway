import { DRIFT_LABELS, DRIFT_RAMP, GEAR_COLOR, RAMP, SELECTED_COLOR, STRANDED_COLOR, windageColor } from '../format'
import type { Layers } from './Map'

/** Class labels for ascending breaks (already rounded server-side), e.g. ["< 0.0006", ..., "≥ 0.008"]. */
function classLabels(breaks: number[]): string[] {
  if (breaks.length === 0) return ['> 0']
  return [
    `< ${breaks[0]}`,
    ...breaks.slice(1).map((b, k) => `${breaks[k]}–${b}`),
    `≥ ${breaks[breaks.length - 1]}`,
  ]
}

const heading = 'text-xs font-medium uppercase tracking-wide text-ink-3'

interface Props {
  breaks: number[]
  windowDays: number
  windageFactors: number[]
  layers: Layers
}

export default function Legend({ breaks, windowDays, windageFactors, layers }: Props) {
  const labels = classLabels(breaks)
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <div className={heading}>Expected nets per ~1 km of coast, {windowDays} days</div>
        <ul className="space-y-1">
          {labels.map((label, k) => (
            <li key={label} className="flex items-center gap-2">
              <span className="h-3 w-5 rounded-sm" style={{ background: RAMP[k] }} />
              <span className="text-ink-2">{label}</span>
            </li>
          ))}
        </ul>
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
            <span className="h-2 w-2 rounded-full" style={{ background: STRANDED_COLOR }} />
            Washed ashore
          </div>
        </div>
      )}
      {layers.drift && (
        <div className="space-y-1">
          <div className={heading}>Where selected items drift</div>
          <div className="flex gap-0.5">
            {DRIFT_RAMP.map((c, k) => (
              <span key={c} className="h-3 flex-1 first:rounded-l-sm last:rounded-r-sm" style={{ background: c }} title={DRIFT_LABELS[k]} />
            ))}
          </div>
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
