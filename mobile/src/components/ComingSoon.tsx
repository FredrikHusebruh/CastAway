import type { ReactNode } from 'react'
import { CloseIcon } from './Icons'

interface Props {
  title: string
  icon: ReactNode
  text: string
  onClose: () => void
}

/**
 * Placeholder screen for a bottom-bar tab that isn't built yet (leaderboard, reporting, profile).
 * These features are out of scope for the prototype (see CLAUDE.md); this is their extension point.
 */
export default function ComingSoon({ title, icon, text, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[3000] flex items-end bg-black/50" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="relative w-full rounded-t-2xl bg-surface px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full text-ink-3 active:bg-surface-2"
          aria-label="Close"
        >
          <CloseIcon />
        </button>
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-ink-2">{icon}</span>
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-ink-2">Coming soon</p>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-2">{text}</p>
      </div>
    </div>
  )
}
