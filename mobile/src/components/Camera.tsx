import { useEffect, useRef, useState } from 'react'
import { GPS_MAX_ACCURACY_M, type Position } from '../game/rules'
import { haptic } from '../motion'

/** A photo taken in the app, with where and when it was taken. */
export interface Shot {
  photo: Blob
  pos: Position
  time: string
}

interface Props {
  title: string
  onCapture: (shot: Shot) => void
  onCancel: () => void
}

const MAX_SIDE = 1280 // px; keeps a photo around 150-300 kB in IndexedDB
const JPEG_QUALITY = 0.75

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : ''
  if (name === 'NotAllowedError') return 'Du må gi appen tilgang til kameraet for å rapportere.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Fant ikke noe kamera på denne enheten.'
  return 'Kunne ikke starte kameraet.'
}

/**
 * In-app camera: a live preview and a shutter button. There is deliberately no file/gallery picker, so every
 * report has a photo taken here and now, stamped with the GPS position and time at the moment it was taken.
 */
export default function Camera({ title, onCapture, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const insecure = !window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !navigator.geolocation
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState<Position | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (insecure) return
    let stream: MediaStream | null = null
    let alive = true
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } }, audio: false })
      .then((s) => {
        const el = video.current
        if (!alive || !el) return s.getTracks().forEach((t) => t.stop())
        stream = s
        el.srcObject = s
        // 'playing' also covers a play() that was interrupted (AbortError) and resumed by the browser
        el.addEventListener('playing', () => alive && setReady(true), { once: true })
        el.play().catch((e: unknown) => {
          if (alive && !(e instanceof DOMException && e.name === 'AbortError')) setError('Kunne ikke vise kamerabildet. Avbryt og prøv igjen.')
        })
      })
      .catch((e: unknown) => alive && setError(cameraError(e)))
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy })
        setGpsError(null)
      },
      (err) =>
        setGpsError(err.code === err.PERMISSION_DENIED ? 'Du må gi appen tilgang til posisjonen din.' : 'Finner ikke posisjonen din ennå.'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    return () => {
      alive = false
      navigator.geolocation.clearWatch(watch)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [insecure])

  const capture = () => {
    const el = video.current
    if (!el || !pos || pos.accuracy > GPS_MAX_ACCURACY_M || busy) return
    haptic(20)
    setBusy(true)
    const time = new Date().toISOString()
    const scale = Math.min(MAX_SIDE / Math.max(el.videoWidth, el.videoHeight), 1)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(el.videoWidth * scale)
    canvas.height = Math.round(el.videoHeight * scale)
    canvas.getContext('2d')?.drawImage(el, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        setBusy(false)
        if (blob) onCapture({ photo: blob, pos, time })
        else setError('Kunne ikke lagre bildet.')
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  }

  const shownError = insecure ? 'Kamera og GPS virker bare over https (eller på localhost).' : error
  const gpsOk = pos !== null && pos.accuracy <= GPS_MAX_ACCURACY_M
  return (
    <div className="relative flex min-h-[60dvh] flex-1 flex-col overflow-hidden rounded-2xl bg-black text-white">
      <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-cover" aria-label="Kamerabilde" />
      <div className="relative flex items-center justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
        <span className="text-sm font-semibold">{title}</span>
        <span
          className={`rounded-full px-2 py-1 text-xs font-medium ${gpsOk ? 'bg-emerald-600' : 'bg-amber-500 text-amber-950'}`}
          role="status"
        >
          {pos ? `GPS ±${Math.round(pos.accuracy)} m` : 'Venter på GPS …'}
        </span>
      </div>
      {(shownError || gpsError) && (
        <p role="alert" className="relative mx-3 rounded-xl bg-red-700 px-3 py-2 text-sm">
          {shownError ?? gpsError}
        </p>
      )}
      {pos && !gpsOk && !shownError && (
        <p className="relative mx-3 rounded-xl bg-black/60 px-3 py-2 text-xs">
          Posisjonen er for unøyaktig (krav ±{GPS_MAX_ACCURACY_M} m). Gå ut i åpent lende og vent litt.
        </p>
      )}
      <div className="relative mt-auto flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-8">
        <button type="button" onClick={onCancel} className="h-11 rounded-full px-4 text-sm font-medium active:bg-white/20">
          Avbryt
        </button>
        <button
          type="button"
          onClick={capture}
          disabled={!ready || !gpsOk || busy}
          className="grid h-18 w-18 place-items-center rounded-full border-4 border-white disabled:opacity-40"
          aria-label="Ta bilde"
        >
          <span className="h-14 w-14 rounded-full bg-white active:scale-90" />
        </button>
        <span className="w-[4.5rem]" aria-hidden="true" />
      </div>
    </div>
  )
}
