// Points, verification, seasons, streaks and badges for found-gear reports. Pure functions, no storage:
// everything is computed from the device's own report history (see store.ts). The numbers below are the
// user's points table; change them here only.
import { distanceKm } from '../format'

/** Points per action (the user's table). */
export const POINTS = {
  find: 10, // report found gear (in-app photo + GPS + type)
  hotspot: 5, // ...found in a forecast hotspot (medium chance or more)
  match: 15, // ...matches a loss reported to BarentsWatch
  delivery: 20, // gear removed and handed in (photo at the harbour reception / waste station)
  nothing: 3, // "checked, nothing here" in a hotspot
  perParticipant: 10, // clean-up event, per participant
  firstOnStretch: 10, // first find on a stretch of coast this season
  streakWeek: 5, // every week with at least one approved action
  duplicate: 3, // the same gear reported again: merged, only the first report gets the full points
} as const

export const COAST_MAX_KM = 2 // finds further from the coast than this are rejected
export const GPS_MAX_ACCURACY_M = 100 // a position less accurate than this is not accepted
export const DUPLICATE_M = 200 // same gear type within this distance ...
export const DUPLICATE_H = 48 // ... and this many hours = the same item
export const SPAM_M = 200 // more than SPAM_MAX finds within SPAM_M metres ...
export const SPAM_H = 1 // ... and SPAM_H hours are rejected
export const SPAM_MAX = 3
export const DAILY_CAP = 100 // points per day (streak bonuses come on top)
export const TRUSTED_AFTER = 3 // approved reports before new reports are approved without a moderator
export const MAX_PARTICIPANTS = 50 // per clean-up event
export const DELIVERY_MAX_DAYS = 14 // a find can be marked as handed in for this long
export const STRETCH_KM = 5 // "a stretch of coast" = one cell of this size
export const HOTSPOT_KM = 1 // a find counts for the coast cell it is in or the nearest one this close

export type ActionKind = 'find' | 'nothing' | 'cleanup' | 'delivery'
export type Status = 'pending' | 'approved' | 'rejected'
/** Result of the coast check: inside the forecast area near/far from the coast, or outside it (unknown). */
export type CoastCheck = 'near' | 'far' | 'unknown'

export interface Position {
  lat: number
  lng: number
  accuracy: number // metres (GPS accuracy at capture)
}

export interface PointLine {
  label: string
  points: number
}

/** What the user submits; evaluate() adds status, points and reasons. */
export interface Draft {
  id: string
  kind: ActionKind
  time: string // ISO, when the photo was taken (in the app)
  pos: Position
  photoId: string
  gearType?: string // find: canonical gear key (format.ts GEAR_LABELS)
  matchedLostId?: string | null // find: the BarentsWatch item the user says it is
  hotspot?: boolean // find / nothing: inside a forecast hotspot
  cellId?: string | null // find / nothing: the forecast coast cell it was in
  stretch?: string | null // find: stretch-of-coast key (geo.stretchKey)
  findId?: string // delivery: the find that was handed in
  kg?: number // delivery: estimated weight
  group?: string // cleanup: group name
  participants?: number // cleanup
}

export interface Report extends Draft {
  status: Status
  lines: PointLine[]
  reasons: string[] // why it was rejected or why it waits for approval
  duplicateOf?: string
}

export interface Evaluation {
  status: Status
  lines: PointLine[]
  reasons: string[]
  duplicateOf?: string
}

// --- dates -------------------------------------------------------------------------------------
const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS

/** Local calendar day (YYYY-MM-DD) of an ISO time: the daily cap resets at local midnight. */
export function localDay(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Season = calendar quarter, e.g. "2026-Q4". Leaderboards reset every quarter; all-time totals are kept. */
export function seasonKey(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`
}

/** "2026-Q4" -> "Q4 2026" */
export function seasonLabel(season: string): string {
  const [year, q] = season.split('-')
  return `${q} ${year}`
}

/** ISO week, e.g. "2026-W41" (weeks start on Monday). */
export function weekKey(iso: string): string {
  const d = new Date(iso)
  const day = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const weekday = day.getUTCDay() || 7
  day.setUTCDate(day.getUTCDate() + 4 - weekday) // the Thursday of this week decides the year
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((day.getTime() - yearStart) / DAY_MS + 1) / 7)
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

// --- helpers -----------------------------------------------------------------------------------
type LatLng = { lat: number; lng: number }
const metres = (a: LatLng, b: LatLng) => distanceKm([a.lat, a.lng], [b.lat, b.lng]) * 1000
const hoursBetween = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / HOUR_MS
const counts = (r: Report) => r.status !== 'rejected'
export const linesTotal = (lines: PointLine[]) => lines.reduce((s, l) => s + l.points, 0)
const sum = linesTotal

// --- evaluation --------------------------------------------------------------------------------
/** Approved reports so far: after TRUSTED_AFTER of them the user is trusted and skips the moderator. */
export const isTrusted = (history: Report[]) => history.filter((r) => r.status === 'approved').length >= TRUSTED_AFTER

function rejected(reason: string): Evaluation {
  return { status: 'rejected', lines: [], reasons: [reason] }
}

/** Why a draft can't be accepted at all, or null. */
function rejection(draft: Draft, history: Report[], coast: CoastCheck): string | null {
  if (!draft.photoId) return 'Mangler bilde tatt i appen.'
  if (!(draft.pos.accuracy <= GPS_MAX_ACCURACY_M)) {
    return `GPS-posisjonen er for unøyaktig (±${Math.round(draft.pos.accuracy)} m, krav ±${GPS_MAX_ACCURACY_M} m).`
  }
  // a delivery is made at the harbour or a waste station, which may be inland
  if (draft.kind !== 'delivery' && coast === 'far') return `Mer enn ${COAST_MAX_KM} km fra kysten.`

  if (draft.kind === 'find') {
    const nearby = history.filter(
      (r) => r.kind === 'find' && counts(r) && hoursBetween(r.time, draft.time) <= SPAM_H && metres(r.pos, draft.pos) <= SPAM_M,
    )
    if (nearby.length >= SPAM_MAX) return `For mange funn fra samme sted på kort tid (maks ${SPAM_MAX} per time).`
  }
  if (draft.kind === 'nothing') {
    if (!draft.hotspot || !draft.cellId) return '«Ingenting her» gir bare poeng i et varslet hotspot.'
    const day = localDay(draft.time)
    const again = history.some(
      (r) => r.kind === 'nothing' && counts(r) && r.cellId === draft.cellId && localDay(r.time) === day,
    )
    if (again) return 'Du har allerede sjekket dette stedet i dag.'
  }
  if (draft.kind === 'cleanup') {
    if (!draft.group?.trim()) return 'Mangler navn på gruppen.'
    if (!draft.participants || draft.participants < 1) return 'Mangler antall deltakere.'
  }
  if (draft.kind === 'delivery') {
    const find = history.find((r) => r.id === draft.findId && r.kind === 'find')
    if (!find) return 'Fant ikke funnet som skal leveres.'
    return deliveryBlock(find, history, draft.time)
  }
  return null
}

/** Why a find can't be marked as handed in at `time`, or null. Used by evaluate() and the "Levert?" button. */
export function deliveryBlock(find: Report, history: Report[], time: string): string | null {
  if (find.kind !== 'find' || !counts(find)) return 'Fant ikke funnet som skal leveres.'
  if (find.duplicateOf) return 'Dette er en sammenslått rapport: registrer leveringen på den første rapporten.'
  if (history.some((r) => r.kind === 'delivery' && r.findId === find.id && counts(r))) return 'Dette funnet er allerede levert.'
  if (Date.parse(time) - Date.parse(find.time) > DELIVERY_MAX_DAYS * DAY_MS) {
    return `Levering må registreres innen ${DELIVERY_MAX_DAYS} dager etter funnet.`
  }
  return null
}

/** An earlier find of the same gear type within DUPLICATE_M and DUPLICATE_H: the same item. */
export function duplicateOf(draft: Draft, history: Report[]): Report | undefined {
  if (draft.kind !== 'find') return undefined
  return history.find(
    (r) =>
      r.kind === 'find' &&
      counts(r) &&
      !r.duplicateOf &&
      r.gearType === draft.gearType &&
      hoursBetween(r.time, draft.time) <= DUPLICATE_H &&
      metres(r.pos, draft.pos) <= DUPLICATE_M,
  )
}

function pointLines(draft: Draft, history: Report[]): PointLine[] {
  switch (draft.kind) {
    case 'find': {
      const lines: PointLine[] = [{ label: 'Funnet redskap', points: POINTS.find }]
      if (draft.hotspot) lines.push({ label: 'I et varslet hotspot', points: POINTS.hotspot })
      if (draft.matchedLostId) lines.push({ label: 'Matcher et innmeldt tap (BarentsWatch)', points: POINTS.match })
      const season = seasonKey(draft.time)
      const firstHere =
        draft.stretch &&
        !history.some((r) => r.kind === 'find' && counts(r) && r.stretch === draft.stretch && seasonKey(r.time) === season)
      if (firstHere) lines.push({ label: 'Første funn på denne kyststrekningen denne sesongen', points: POINTS.firstOnStretch })
      return lines
    }
    case 'nothing':
      return [{ label: 'Sjekket – ingenting her', points: POINTS.nothing }]
    case 'cleanup': {
      const n = Math.min(draft.participants ?? 0, MAX_PARTICIPANTS)
      return [{ label: `Ryddeaksjon, ${n} deltaker${n === 1 ? '' : 'e'}`, points: POINTS.perParticipant * n }]
    }
    case 'delivery':
      return [{ label: 'Fjernet og levert', points: POINTS.delivery }]
  }
}

/** Points already earned (or pending) on the draft's day, for the daily cap. */
function pointsOnDay(history: Report[], day: string): number {
  return history.filter((r) => counts(r) && localDay(r.time) === day).reduce((s, r) => s + sum(r.lines), 0)
}

/** Cuts the lines down to what is left of the daily cap, with a visible negative line. */
function capped(lines: PointLine[], history: Report[], time: string): PointLine[] {
  const left = Math.max(DAILY_CAP - pointsOnDay(history, localDay(time)), 0)
  const total = sum(lines)
  return total > left ? [...lines, { label: `Over dagstaket (maks ${DAILY_CAP} poeng per dag)`, points: left - total }] : lines
}

/**
 * Checks a report and works out its points, in this order: rejection (photo/GPS, far from the coast, spam,
 * repeated "nothing here", missing details), duplicate merging, base points + bonuses, daily cap, and
 * trust (a new user's points stay pending until a moderator approves them).
 */
export function evaluate(draft: Draft, history: Report[], coast: CoastCheck): Evaluation {
  const reason = rejection(draft, history, coast)
  if (reason) return rejected(reason)

  const dup = duplicateOf(draft, history)
  const lines = capped(
    dup ? [{ label: 'Samme redskap er allerede meldt inn (slått sammen)', points: POINTS.duplicate }] : pointLines(draft, history),
    history,
    draft.time,
  )

  const reasons: string[] = []
  if (coast === 'unknown' && draft.kind !== 'delivery') reasons.push('Utenfor prognoseområdet: avstanden til kysten kunne ikke sjekkes.')
  if (!isTrusted(history)) reasons.push(`Ny bruker: poengene er foreløpige til de er godkjent (${TRUSTED_AFTER} godkjente rapporter gir tillit).`)
  return {
    status: reasons.length ? 'pending' : 'approved',
    lines,
    reasons,
    ...(dup ? { duplicateOf: dup.id } : {}),
  }
}

// --- moderation --------------------------------------------------------------------------------
/**
 * A moderator approves or rejects a pending report. Rejecting a find also settles what hangs on it:
 * the first report merged into it (same item) takes over as the original and gets full points (worked out
 * against the history before it, daily cap included); later duplicates and any delivery move to that one.
 * With no duplicate left, its deliveries are rejected too. Returns the new history.
 */
export function moderate(history: Report[], id: string, status: Exclude<Status, 'pending'>): Report[] {
  const target = history.find((r) => r.id === id)
  if (!target || target.status !== 'pending') return history
  const reasons = status === 'approved' ? [] : ['Avvist av moderator.']
  let next = history.map((r) => (r.id === id ? { ...r, status, reasons } : r))
  if (status === 'approved' || target.kind !== 'find') return next

  const dups = next.filter((r) => r.duplicateOf === id && counts(r)).sort((a, b) => a.time.localeCompare(b.time))
  const heir = dups[0]
  if (heir) {
    const before = next.filter((r) => r.time < heir.time && r.id !== heir.id)
    const { duplicateOf: _merged, ...draft } = heir
    void _merged
    const promoted: Report = { ...draft, lines: capped(pointLines(draft, before), before, heir.time) }
    next = next.map((r) =>
      r.id === heir.id
        ? promoted
        : r.duplicateOf === id
          ? { ...r, duplicateOf: heir.id }
          : r.kind === 'delivery' && r.findId === id
            ? { ...r, findId: heir.id }
            : r,
    )
  } else {
    next = next.map((r) =>
      r.kind === 'delivery' && r.findId === id && counts(r)
        ? { ...r, status: 'rejected' as const, reasons: ['Funnet som ble levert, er avvist av moderator.'] }
        : r,
    )
  }
  return next
}

// --- totals, streaks, badges -------------------------------------------------------------------
/** +POINTS.streakWeek for every week with an approved action, credited to that week's first approved action. */
export function streakBonuses(history: Report[]): { week: string; time: string; points: number }[] {
  const first = new Map<string, string>()
  for (const r of history) {
    if (r.status !== 'approved') continue
    const week = weekKey(r.time)
    const t = first.get(week)
    if (!t || r.time < t) first.set(week, r.time)
  }
  return [...first.entries()].map(([week, time]) => ({ week, time, points: POINTS.streakWeek }))
}

/** Consecutive weeks with an approved action, ending this week (or last week, if nothing yet this week). */
export function currentStreak(history: Report[], now: string): number {
  const weeks = new Set(streakBonuses(history).map((b) => b.week))
  let t = Date.parse(now)
  if (!weeks.has(weekKey(new Date(t).toISOString()))) t -= 7 * DAY_MS
  let n = 0
  while (weeks.has(weekKey(new Date(t).toISOString()))) {
    n++
    t -= 7 * DAY_MS
  }
  return n
}

export interface Totals {
  approved: number // counts on the leaderboard
  pending: number // waiting for a moderator
}

/** Points in a season (or all-time when season is null): approved report points + streak bonuses. */
export function totals(history: Report[], season: string | null): Totals {
  const inSeason = (iso: string) => season === null || seasonKey(iso) === season
  let approved = 0
  let pending = 0
  for (const r of history) {
    if (!inSeason(r.time)) continue
    if (r.status === 'approved') approved += sum(r.lines)
    if (r.status === 'pending') pending += sum(r.lines)
  }
  for (const b of streakBonuses(history)) if (inSeason(b.time)) approved += b.points
  return { approved, pending }
}

export interface Badge {
  id: string
  name: string
  text: string
  earned: boolean
  progress?: string
}

export function badges(history: Report[]): Badge[] {
  const ok = history.filter((r) => r.status === 'approved')
  const finds = ok.filter((r) => r.kind === 'find' && !r.duplicateOf)
  const hotspotFinds = finds.filter((r) => r.hotspot).length
  const kg = ok.filter((r) => r.kind === 'delivery').reduce((s, r) => s + (r.kg ?? 0), 0)
  return [
    {
      id: 'first-net',
      name: 'Første garn',
      text: 'Fant et garn og fikk funnet godkjent.',
      earned: finds.some((r) => r.gearType === 'nets'),
    },
    {
      id: 'hotspot-hunter',
      name: 'Hotspot-jeger',
      text: 'Fem godkjente funn i varslede hotspots.',
      earned: hotspotFinds >= 5,
      progress: `${Math.min(hotspotFinds, 5)}/5`,
    },
    {
      id: 'kg-100',
      name: '100 kg fjernet',
      text: 'Levert minst 100 kg redskap til mottak.',
      earned: kg >= 100,
      progress: `${Math.min(Math.round(kg), 100)}/100 kg`,
    },
    {
      id: 'confirmed-loss',
      name: 'Bekreftet tapt redskap',
      text: 'Fant et redskap som var meldt tapt til BarentsWatch.',
      earned: finds.some((r) => !!r.matchedLostId),
    },
  ]
}
