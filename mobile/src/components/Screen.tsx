import { type ReactNode, useEffect } from 'react'
import { CloseIcon } from './Icons'

interface Props {
  title: string
  icon: ReactNode
  onClose: () => void
  leaving: boolean // animating out (see usePresence)
  children: ReactNode
}

/**
 * A full screen opened from the bottom menu (Rapportering, Toppliste, Profil). It covers the map and the
 * bottom sheet but leaves the menu visible; on a PC the content is a centred column.
 */
export default function Screen({ title, icon, onClose, leaving, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={`fixed inset-x-0 top-0 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-[2000] flex flex-col bg-surface text-ink ${
        leaving ? 'pointer-events-none animate-fade-out' : 'animate-fade-in'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-title"
    >
      <header className="border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-2">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-ink-2">{icon}</span>
          <h2 id="screen-title" className="flex-1 text-lg font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid h-10 w-10 place-items-center rounded-full text-ink-3 active:bg-surface-2"
            aria-label="Lukk og gå til kartet"
          >
            <CloseIcon />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
