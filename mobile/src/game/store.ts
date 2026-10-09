// The user's reports, photos and profile, stored ONLY on this device: IndexedDB for reports + photos,
// localStorage for the profile. Nothing is uploaded. If storage is blocked (private mode, cleared site
// data) the app still works for the session, it just doesn't remember.
import { useCallback, useEffect, useRef, useState } from 'react'
import { type CoastCheck, type Draft, type Report, type Status, evaluate, moderate as moderated } from './rules'

export type TeamType = 'skoleklasse' | 'idrettslag' | 'bedrift' | 'annet'

export interface Profile {
  name: string
  team: string // '' = no team
  teamType: TeamType
  kommune: string // '' = not set
}

const PROFILE_KEY = 'castaway.profile'
const DEFAULT_PROFILE: Profile = { name: '', team: '', teamType: 'annet', kommune: '' }
const DB_NAME = 'castaway'
const REPORTS = 'reports'
const PHOTOS = 'photos'

function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    return raw ? { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<Profile>) } : DEFAULT_PROFILE
  } catch {
    return DEFAULT_PROFILE
  }
}

function saveProfile(profile: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
  } catch {
    // storage blocked: keep it for this session only
  }
}

// --- IndexedDB (no library: two object stores, a handful of calls) ------------------------------
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(REPORTS, { keyPath: 'id' })
      req.result.createObjectStore(PHOTOS)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(store, mode).objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

const loadReports = () => run<Report[]>(REPORTS, 'readonly', (s) => s.getAll() as IDBRequest<Report[]>)
const putReport = (r: Report) => run(REPORTS, 'readwrite', (s) => s.put(r))
const putPhoto = (id: string, blob: Blob) => run(PHOTOS, 'readwrite', (s) => s.put(blob, id))

// Photos taken this session, so they show even when IndexedDB is unavailable.
const sessionPhotos = new Map<string, Blob>()

export async function getPhoto(id: string): Promise<Blob | null> {
  const cached = sessionPhotos.get(id)
  if (cached) return cached
  try {
    return ((await run<Blob | undefined>(PHOTOS, 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>)) ?? null)
  } catch {
    return null
  }
}

/** Object URL for a blob, created and revoked by the same effect run (StrictMode's remount gets a fresh one). */
export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<{ blob: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!blob) return
    let objectUrl: string | null = null
    let alive = true
    void Promise.resolve().then(() => {
      if (!alive) return
      objectUrl = URL.createObjectURL(blob)
      setUrl({ blob, url: objectUrl })
    })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [blob])
  return url && url.blob === blob ? url.url : null
}

/** Object URL for a stored photo (revoked on unmount). */
export function usePhoto(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) return
    let objectUrl: string | null = null
    let alive = true
    void getPhoto(id).then((blob) => {
      if (!alive || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id])
  return id ? url : null
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const byTime = (a: Report, b: Report) => a.time.localeCompare(b.time)

export interface Game {
  reports: Report[] // oldest first
  profile: Profile
  saved: boolean // false: storage unavailable, nothing survives a reload
  loaded: boolean // the stored history has been read (reports are only checked against the full history)
  setProfile: (p: Profile) => void
  /** Checks and scores a report against the history, stores it with its photo and returns it. */
  submit: (draft: Omit<Draft, 'id' | 'photoId'>, photo: Blob, coast: CoastCheck) => Promise<Report>
  /** Demo moderator: approve or reject a pending report. */
  moderate: (id: string, status: Exclude<Status, 'pending'>) => void
  resetAll: () => Promise<void>
}

export function useGame(): Game {
  const [reports, setReports] = useState<Report[]>([])
  const [profile, setProfileState] = useState<Profile>(loadProfile)
  const [saved, setSaved] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef<Report[]>([]) // evaluate against the newest history, even between renders
  const ready = useRef<Promise<void> | null>(null) // resolves once the stored history is in `latest`

  const update = useCallback((next: Report[]) => {
    latest.current = next
    setReports(next)
  }, [])

  useEffect(() => {
    ready.current ??= loadReports()
      .then((rs) => {
        const known = new Set(latest.current.map((r) => r.id))
        update([...rs.filter((r) => !known.has(r.id)), ...latest.current].sort(byTime))
      })
      .catch(() => setSaved(false))
      .finally(() => setLoaded(true))
  }, [update])

  const setProfile = useCallback((p: Profile) => {
    setProfileState(p)
    saveProfile(p)
  }, [])

  const submit = useCallback<Game['submit']>(
    async (draft, photo, coast) => {
      await ready.current // the daily cap, duplicates, spam and trust need the whole history
      const id = newId()
      const full: Draft = { ...draft, id, photoId: id }
      const report: Report = { ...full, ...evaluate(full, latest.current, coast) }
      sessionPhotos.set(id, photo)
      update([...latest.current, report].sort(byTime))
      try {
        await putPhoto(id, photo)
        await putReport(report)
      } catch {
        setSaved(false)
      }
      return report
    },
    [update],
  )

  const moderate = useCallback<Game['moderate']>(
    (id, status) => {
      const before = latest.current
      const next = moderated(before, id, status)
      update(next)
      // store every report the decision changed (a rejected find can pass its role on to a merged duplicate)
      const changed = next.filter((r, k) => r !== before[k])
      Promise.all(changed.map(putReport)).catch(() => setSaved(false))
    },
    [update],
  )

  const resetAll = useCallback(async () => {
    update([])
    sessionPhotos.clear()
    setProfile(DEFAULT_PROFILE)
    try {
      localStorage.removeItem(PROFILE_KEY)
      await run(REPORTS, 'readwrite', (s) => s.clear())
      await run(PHOTOS, 'readwrite', (s) => s.clear())
    } catch {
      // nothing stored
    }
  }, [update, setProfile])

  return { reports, profile, saved, loaded, setProfile, submit, moderate, resetAll }
}
