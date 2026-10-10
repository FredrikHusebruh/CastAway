import {
  DRIFT_RAMP,
  REPORT_COLOR,
  RAMP,
  RAMP_OPACITY,
  SELECTED_COLOR,
  STRANDED_COLOR,
  beachingRange,
  formatNets,
  formatPercent,
  gearLabel,
  windageColor,
} from '../format'
import { gearIconUrl } from '../gearIcons'
import type { Layers } from './Map'

// Gear types in the legend, as the backend knows them (config.GEAR_FLOAT_PROB); 'unknown' shares the 'generic' icon.
const LEGEND_GEAR = ['crab_pot', 'fish_pot', 'nets', 'longline', 'seine', 'sensor_cable', 'generic']

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
            ? `Sjanse for at redskapet driver i land per ~1 km, ${windowDays} dager`
            : `Forventede garn per ~1 km kyst, ${windowDays} dager`}
        </div>
        <div className="h-3 rounded-sm" style={{ background: gradient(RAMP, RAMP_OPACITY) }} />
        <div className="flex justify-between text-xs text-ink-3">
          <span>≤ {itemMode ? formatPercent(lo) : formatNets(lo)}</span>
          <span>log-skala</span>
          <span>≥ {itemMode ? formatPercent(hi) : formatNets(hi)}</span>
        </div>
      </div>
      {layers.paths && (
        <div className="space-y-1">
          <div className={heading}>Partikkelbaner · vindpåvirkning</div>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {windageFactors.map((f) => (
              <li key={f} className="flex items-center gap-2 text-ink-2">
                <span className="h-0.5 w-5" style={{ background: windageColor(f, windageFactors) }} />
                {Math.round(f * 100)}%{f === 0 ? ' (bare strøm)' : ''}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 text-ink-2">
            <span className="h-2 w-2" style={{ background: STRANDED_COLOR }} /> {/* square, as on the map */}
            Drevet i land
          </div>
        </div>
      )}
      {layers.drift && (
        <div className="space-y-1">
          <div className={heading}>Hvor valgte redskap driver</div>
          <div className="h-3 rounded-sm" style={{ background: gradient(DRIFT_RAMP) }} />
          <div className="flex justify-between text-xs text-ink-3">
            <span>Mindre sannsynlig</span>
            <span>Mer sannsynlig</span>
          </div>
        </div>
      )}
      <div className="space-y-1">
        <div className={heading}>Tapte redskap</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-ink-2">
          {LEGEND_GEAR.map((type) => (
            <span key={type} className="flex items-center gap-2">
              <img src={gearIconUrl(type)} alt="" className="h-5 w-5" />
              {gearLabel(type)}
            </span>
          ))}
          <span className="flex items-center gap-2">
            <span className="h-5 w-5 rounded-full ring-2 ring-white" style={{ background: SELECTED_COLOR }} />
            Valgt
          </span>
          {layers.reports && (
            <span className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full ring-2 ring-white" style={{ background: REPORT_COLOR }} />
              Mine funn
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
