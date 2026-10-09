import { useEffect, useState } from 'react'
import { CloseIcon } from './Icons'

/** One step of the walkthrough; `target` matches a `data-tour` attribute in the UI (none = centred card). */
interface Step {
  target?: string
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    title: 'Welcome to CastAway',
    body: 'CastAway forecasts where lost fishing gear will wash ashore on the Norwegian coast, using ocean currents and wind from MET Norway.',
  },
  {
    target: 'map',
    title: 'The map',
    body: 'Orange dots are stretches of coast where nets are expected to wash ashore; darker means more. Dark blue dots are reported lost gear. Tap any dot for details.',
  },
  {
    target: 'date',
    title: 'Pick a date',
    body: 'Step through days with ‹ ›, drag the slider or press play. Past days are hindcast, later days are forecast. Each date shows the 7 days up to it.',
  },
  {
    target: 'panel',
    title: 'Hotspots, layers and legend',
    body: 'Tap or drag the panel up to see the top hotspots (by most nets or nearest you), turn map layers on and off, and read what the colours mean.',
  },
  {
    target: 'nav',
    title: 'The menu',
    body: 'Home takes you back to the map of the whole region. Leaderboard, Rapportering (reporting gear) and Profile are coming soon. Zoom with the + and − buttons on the map, or pinch.',
  },
  {
    target: 'help',
    title: "That's it",
    body: 'Tap the question mark any time to see this guide again.',
  },
]

const PAD = 6 // spotlight padding around the target, px
const GAP = 12 // space between spotlight and card, px

function useTargetRect(target: string | undefined): DOMRect | null {
  // re-render on resize/rotation so the spotlight follows its target
  const [, setSize] = useState(0)
  useEffect(() => {
    const onResize = () => setSize(window.innerWidth * 10000 + window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return target ? (document.querySelector(`[data-tour="${target}"]`)?.getBoundingClientRect() ?? null) : null
}

/** Step-by-step walkthrough: dims the screen, spotlights one part of the UI and explains it. */
export default function Guide({ onClose, leaving }: { onClose: () => void; leaving: boolean }) {
  const [i, setI] = useState(0)
  const step = STEPS[i]
  const rect = useTargetRect(step.target)
  const last = i === STEPS.length - 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // card goes below the spotlight if the target sits in the top half of the screen, otherwise above it
  const below = rect ? rect.top + rect.height / 2 < window.innerHeight / 2 : false
  const cardPos = !rect
    ? { top: '50%', transform: 'translateY(-50%)' }
    : below
      ? { top: Math.min(rect.bottom + PAD + GAP, window.innerHeight - 220) }
      : { bottom: Math.max(window.innerHeight - rect.top + PAD + GAP, 16) }

  return (
    <div
      className={`fixed inset-0 z-[3000] ${leaving ? 'pointer-events-none animate-fade-out' : 'animate-fade-in'}`}
      role="dialog" aria-modal="true" aria-labelledby="guide-title">
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-accent transition-all duration-300"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      <div
        key={i}
        className="absolute inset-x-4 mx-auto max-w-sm animate-fade-up rounded-2xl bg-surface p-4 text-ink shadow-xl"
        style={cardPos}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full text-ink-3 active:bg-surface-2"
          aria-label="Close guide"
        >
          <CloseIcon />
        </button>
        <div className="text-xs font-medium text-ink-3">
          {i + 1} of {STEPS.length}
        </div>
        <h2 id="guide-title" className="mt-0.5 pr-8 text-lg font-semibold">
          {step.title}
        </h2>
        <p className="mt-1 text-sm text-ink-2">{step.body}</p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1.5" aria-hidden="true">
            {STEPS.map((s, k) => (
              <span key={s.title} className={`h-1.5 w-1.5 rounded-full ${k === i ? 'bg-accent' : 'bg-line'}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <button
                type="button"
                onClick={() => setI(i - 1)}
                className="h-10 rounded-full px-4 text-sm font-medium text-ink-2 active:bg-surface-2"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? onClose() : setI(i + 1))}
              className="h-10 rounded-full bg-ink px-5 text-sm font-semibold text-surface active:opacity-80"
            >
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
