// Small motion helpers: exit animations, tweened numbers, the draggable bottom sheet and haptics.
import { type PointerEvent, type MouseEvent, type RefObject, useEffect, useRef, useState } from 'react'

/** Matches the exit keyframes in index.css (fade-out, fade-down-out, sheet-down). */
export const EXIT_MS = 220

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** A short vibration on Android (iOS Safari has no vibration API, so it is silently skipped). */
export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // some browsers throw when vibration is blocked; feedback is optional
  }
}

/**
 * Keeps the last non-null value rendered for EXIT_MS after it becomes null, so it can animate out.
 * Returns [value to render, whether it is leaving].
 */
export function usePresence<T>(value: T | null): [T | null, boolean] {
  const [shown, setShown] = useState(value)
  const [leaving, setLeaving] = useState(false)
  // adjust state while rendering (React's pattern for deriving state from props)
  if (value !== null && (value !== shown || leaving)) {
    setShown(value)
    setLeaving(false)
  } else if (value === null && shown !== null && !leaving) {
    setLeaving(true)
  }
  useEffect(() => {
    if (!leaving) return
    const t = setTimeout(() => {
      setShown(null)
      setLeaving(false)
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [leaving])
  return [shown, leaving]
}

/** Animates a number towards its target (ease-out), e.g. totals that change with the date. */
export function useTweenedNumber(target: number, ms = 450): number {
  const [value, setValue] = useState(target)
  const current = useRef(target)
  useEffect(() => {
    const from = current.current
    const duration = reducedMotion() ? 0 : ms
    const start = performance.now()
    let raf = requestAnimationFrame(function step(now) {
      const t = duration === 0 ? 1 : Math.min((now - start) / duration, 1)
      current.current = from + (target - from) * (1 - (1 - t) ** 3)
      setValue(current.current)
      if (t < 1) raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return value
}

const DRAG_START_PX = 6 // movement before a press becomes a drag (smaller = tap)
const FLICK_PX_PER_MS = 0.4 // release speed that decides open/closed regardless of position

interface DragState {
  y0: number
  h0: number
  max: number
  moved: boolean
  samples: [number, number][] // recent [timeStamp, clientY] for the release velocity
}

/**
 * Lets the user drag the bottom sheet open/closed with a finger. The sheet follows the finger
 * (with a rubber-band past its ends) and on release snaps open or closed, by flick speed or position.
 * `panelRef` is the expandable part's content, whose height is the fully open height.
 */
export function useSheetDrag(open: boolean, setOpen: (open: boolean) => void, panelRef: RefObject<HTMLElement | null>) {
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const drag = useRef<DragState | null>(null)
  const dragged = useRef(false)

  const heightAt = (s: DragState, clientY: number) => {
    const h = s.h0 + (s.y0 - clientY)
    if (h < 0) return h / 4
    if (h > s.max) return s.max + (h - s.max) / 4
    return h
  }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const max = panelRef.current?.offsetHeight ?? 0
    drag.current = { y0: e.clientY, h0: open ? max : 0, max, moved: false, samples: [[e.timeStamp, e.clientY]] }
    dragged.current = false
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = drag.current
    if (!s) return
    if (!s.moved && Math.abs(s.y0 - e.clientY) < DRAG_START_PX) return
    s.moved = true
    s.samples = [...s.samples.slice(-4), [e.timeStamp, e.clientY]]
    setDragHeight(Math.max(0, heightAt(s, e.clientY)))
  }

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const s = drag.current
    drag.current = null
    if (!s?.moved) return
    dragged.current = true // swallow the click that follows the drag
    const [t0, y0] = s.samples[0]
    const velocity = (y0 - e.clientY) / Math.max(1, e.timeStamp - t0) // px/ms, positive = upwards
    const next = Math.abs(velocity) > FLICK_PX_PER_MS ? velocity > 0 : heightAt(s, e.clientY) > s.max / 2
    setDragHeight(null)
    if (next !== open) haptic()
    setOpen(next)
  }

  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (!dragged.current) return
    dragged.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  return {
    dragHeight,
    dragHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture },
  }
}
