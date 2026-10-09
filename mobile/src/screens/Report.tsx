import { useEffect, useMemo, useState } from 'react'
import { type CellCollection, type CoastInfo, type GearCollection, type IndexInfo, fetchBeaching } from '../api'
import Camera, { type Shot } from '../components/Camera'
import { PointLines, StatusChip } from '../components/Points'
import { formatDateTime, formatKm, gearLabel } from '../format'
import { reportTitle } from '../game/labels'
import { coastCheck, coastSet, forecastDateFor, hotspotAt, matchCandidates, stretchKey } from '../game/geo'
import {
  type ActionKind,
  COAST_MAX_KM,
  type Draft,
  MAX_PARTICIPANTS,
  POINTS,
  type Report as ReportT,
  deliveryBlock,
  evaluate,
  linesTotal,
} from '../game/rules'
import { type Game, useObjectUrl, usePhoto } from '../game/store'

interface Props {
  game: Game
  index: IndexInfo
  gear: GearCollection | null
  coast: CoastInfo | null
  onShowOnMap: (latLng: [number, number]) => void
}

type Flow =
  | { step: 'menu' }
  | { step: 'camera'; kind: ActionKind; findId?: string }
  | { step: 'details'; kind: ActionKind; shot: Shot; findId?: string }
  | { step: 'result'; report: ReportT }

const GEAR_TYPES = ['nets', 'longline', 'crab_pot', 'fish_pot', 'seine', 'sensor_cable', 'generic']
const EMPTY: CellCollection = { type: 'FeatureCollection', features: [] }
const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })

const ACTIONS: { kind: ActionKind; title: string; points: string; text: string }[] = [
  {
    kind: 'find',
    title: 'Funnet redskap',
    points: `${POINTS.find}+ poeng`,
    text: `Ta bilde av redskapet. +${POINTS.hotspot} i et varslet hotspot, +${POINTS.match} hvis det matcher et meldt tap, +${POINTS.firstOnStretch} for første funn på kyststrekningen denne sesongen.`,
  },
  {
    kind: 'nothing',
    title: 'Sjekket – ingenting her',
    points: `${POINTS.nothing} poeng`,
    text: 'Du har lett i et varslet hotspot uten å finne noe. Det hjelper oss å måle hvor treffsikker prognosen er. Én gang per sted per dag.',
  },
  {
    kind: 'cleanup',
    title: 'Ryddeaksjon',
    points: `${POINTS.perParticipant} per deltaker`,
    text: `Ta et gruppebilde der dere rydder, og oppgi gruppe og antall deltakere (maks ${MAX_PARTICIPANTS}).`,
  },
]

const CAMERA_TITLE: Record<ActionKind, string> = {
  find: 'Ta bilde av redskapet',
  nothing: 'Ta bilde av stedet',
  cleanup: 'Ta et gruppebilde',
  delivery: 'Ta bilde ved levering',
}

const COAST_TEXT = {
  near: `Innenfor ${COAST_MAX_KM} km fra kysten`,
  far: `Mer enn ${COAST_MAX_KM} km fra kysten`,
  unknown: 'Utenfor prognoseområdet – kysten kan ikke sjekkes',
}

const field = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink'
const primary = 'h-12 w-full rounded-xl bg-accent text-sm font-semibold text-white active:opacity-80 disabled:opacity-40'
const secondary = 'h-11 rounded-xl border border-line px-4 text-sm font-semibold text-ink active:bg-surface-2'

function Thumb({ photoId, className = 'h-12 w-12' }: { photoId: string; className?: string }) {
  const url = usePhoto(photoId)
  return url ? (
    <img src={url} alt="" className={`${className} shrink-0 rounded-lg object-cover`} />
  ) : (
    <span className={`${className} shrink-0 rounded-lg bg-surface-2`} />
  )
}

/** Step 2: what was found, what the forecast says about the spot, and the points it would give. */
function Details({
  flow,
  game,
  index,
  gear,
  coast,
  onSubmitted,
  onCancel,
}: {
  flow: Extract<Flow, { step: 'details' }>
  game: Game
  index: IndexInfo
  gear: GearCollection | null
  coast: CoastInfo | null
  onSubmitted: (r: ReportT) => void
  onCancel: () => void
}) {
  const { kind, shot, findId } = flow
  const [gearType, setGearType] = useState('nets')
  const [matched, setMatched] = useState<string | null>(null)
  const [group, setGroup] = useState(game.profile.team)
  const [participants, setParticipants] = useState(5)
  const [kg, setKg] = useState(10)
  const [cells, setCells] = useState<CellCollection | null>(null)
  const [sending, setSending] = useState(false)
  const photoUrl = useObjectUrl(shot.photo)

  // the regional forecast for the day of the report: is this a hotspot, and which lost items strand here?
  // Forecast dates are UTC days, so use the UTC day of the photo (the daily cap uses the local day).
  const date = forecastDateFor(shot.time.slice(0, 10), index.dates)
  useEffect(() => {
    if (!date) return
    let alive = true
    fetchBeaching(date)
      .then((c) => alive && setCells(c))
      .catch(() => alive && setCells(EMPTY))
    return () => {
      alive = false
    }
  }, [date])

  // computed once per photo / forecast file, not on every keystroke in the form
  const coastCells = useMemo(() => (coast ? coastSet(coast) : null), [coast])
  const coastResult = useMemo(() => coastCheck(shot.pos, coast, coastCells, index.bbox), [shot.pos, coast, coastCells, index.bbox])
  const { cell, hotspot } = useMemo(() => hotspotAt(shot.pos, cells, index.color_breaks ?? []), [shot.pos, cells, index.color_breaks])
  const cellId = cell?.properties.cell_id ?? null
  const candidates = useMemo(
    () => (kind === 'find' ? matchCandidates(shot.pos, gearType, cells, gear) : []),
    [kind, shot.pos, gearType, cells, gear],
  )
  const matchedId = candidates.some((c) => c.gear.id === matched) ? matched : null

  const draft: Omit<Draft, 'id' | 'photoId'> = useMemo(
    () => ({
      kind,
      time: shot.time,
      pos: shot.pos,
      ...(kind === 'find' ? { gearType, matchedLostId: matchedId, stretch: stretchKey(shot.pos) } : {}),
      ...(kind === 'find' || kind === 'nothing' ? { hotspot, cellId } : {}),
      ...(kind === 'cleanup' ? { group, participants } : {}),
      ...(kind === 'delivery' ? { findId, kg } : {}),
    }),
    [kind, shot, gearType, matchedId, hotspot, cellId, group, participants, findId, kg],
  )
  const preview = useMemo(
    () => evaluate({ ...draft, id: 'preview', photoId: 'preview' }, game.reports, coastResult),
    [draft, game.reports, coastResult],
  )
  const loading = !game.loaded || (date !== null && cells === null && kind !== 'cleanup' && kind !== 'delivery')

  const send = async () => {
    setSending(true)
    onSubmitted(await game.submit(draft, shot.photo, coastResult))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3">
        {photoUrl ? (
          <img src={photoUrl} alt="Bildet du tok" className="h-28 w-28 shrink-0 rounded-xl object-cover" />
        ) : (
          <span className="h-28 w-28 shrink-0 rounded-xl bg-surface-2" />
        )}
        <div className="min-w-0 space-y-1 text-sm">
          <div className="font-semibold">{CAMERA_TITLE[kind].replace('Ta ', 'Tatt ')}</div>
          <div className="text-ink-2">{formatDateTime(shot.time)}</div>
          <div className="text-ink-2">
            {shot.pos.lat.toFixed(4)}°N {shot.pos.lng.toFixed(4)}°Ø · ±{Math.round(shot.pos.accuracy)} m
          </div>
          {kind !== 'delivery' && (
            <>
              <div className={coastResult === 'far' ? 'font-medium text-red-700' : 'text-ink-2'}>{COAST_TEXT[coastResult]}</div>
              <div className="text-ink-2">
                {loading ? 'Sjekker prognosen …' : hotspot ? 'I et varslet hotspot' : 'Ikke i et varslet hotspot'}
              </div>
            </>
          )}
        </div>
      </div>

      {kind === 'find' && (
        <>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Hva fant du?</legend>
            <div className="flex flex-wrap gap-2">
              {GEAR_TYPES.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={gearType === g}
                  onClick={() => setGearType(g)}
                  className={`h-10 rounded-full border px-3 text-sm font-medium ${
                    gearType === g ? 'border-accent bg-accent text-white' : 'border-line text-ink-2'
                  }`}
                >
                  {gearLabel(g)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Er det et redskap som er meldt tapt?</legend>
            <p className="mb-2 text-xs text-ink-3">
              Redskap av samme type som prognosen sier kan ha drevet i land her (BarentsWatch). Velg bare hvis du er
              rimelig sikker – en moderator sjekker.
            </p>
            <div className="divide-y divide-line rounded-xl border border-line">
              {[...candidates.map((c) => ({ id: c.gear.id, label: `${gearLabel(c.gear.gear_type)}, meldt tapt ${formatDay(c.gear.lost_time)}`, sub: `Mistet ${formatKm(c.km)} herfra` })), { id: null, label: candidates.length ? 'Ingen av disse / vet ikke' : 'Ingen meldte tap passer her', sub: '' }].map((o) => (
                <label key={o.id ?? 'none'} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="match"
                    checked={matchedId === o.id}
                    onChange={() => setMatched(o.id)}
                    className="h-5 w-5 accent-[var(--accent)]"
                  />
                  <span>
                    {o.label}
                    {o.sub && <span className="block text-xs text-ink-3">{o.sub}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}

      {kind === 'cleanup' && (
        <div className="grid gap-3">
          <label className="text-sm font-semibold">
            Gruppe
            <input className={`${field} mt-1 font-normal`} value={group} onChange={(e) => setGroup(e.target.value)} placeholder="F.eks. Vadsø IL eller klasse 9B" />
          </label>
          <label className="text-sm font-semibold">
            Antall deltakere (maks {MAX_PARTICIPANTS})
            <input
              className={`${field} mt-1 font-normal`}
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_PARTICIPANTS}
              value={participants}
              onChange={(e) => setParticipants(Math.max(0, Math.min(MAX_PARTICIPANTS, Math.round(Number(e.target.value)))))}
            />
          </label>
        </div>
      )}

      {kind === 'delivery' && (
        <label className="text-sm font-semibold">
          Omtrent hvor mange kilo?
          <input
            className={`${field} mt-1 font-normal`}
            type="number"
            inputMode="decimal"
            min={0}
            value={kg}
            onChange={(e) => setKg(Math.max(0, Number(e.target.value)))}
          />
        </label>
      )}

      <div className="rounded-2xl bg-surface-2 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{preview.status === 'rejected' ? 'Kan ikke godkjennes' : 'Dette gir'}</span>
          {preview.status !== 'rejected' && <StatusChip status={preview.status} />}
        </div>
        {preview.status === 'rejected' ? (
          <p className="text-sm text-red-700">{preview.reasons[0]}</p>
        ) : (
          <>
            <PointLines lines={preview.lines} />
            {preview.reasons.map((r) => (
              <p key={r} className="mt-1 text-xs text-ink-3">
                {r}
              </p>
            ))}
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button type="button" className={secondary} onClick={onCancel}>
          Avbryt
        </button>
        <button type="button" className={primary} disabled={preview.status === 'rejected' || loading || sending} onClick={send}>
          Send rapport
        </button>
      </div>
    </div>
  )
}

function Result({ report, onMap, onDone }: { report: ReportT; onMap: () => void; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Thumb photoId={report.photoId} className="h-16 w-16" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{reportTitle(report)}</div>
          <div className="text-sm text-ink-2">Rapporten er lagret.</div>
        </div>
        <StatusChip status={report.status} />
      </div>
      <PointLines lines={report.lines} />
      {report.reasons.map((r) => (
        <p key={r} className="text-xs text-ink-3">
          {r}
        </p>
      ))}
      <div className="flex gap-2">
        {report.kind !== 'delivery' && (
          <button type="button" className={`${secondary} flex-1`} onClick={onMap}>
            Vis på kartet
          </button>
        )}
        <button type="button" className={`${primary} flex-1`} onClick={onDone}>
          Ferdig
        </button>
      </div>
    </div>
  )
}

/** "Mine rapporter": everything reported on this device, newest first; finds can be marked as handed in. */
function MyReports({ game, onDeliver }: { game: Game; onDeliver: (findId: string) => void }) {
  const [now] = useState(() => new Date().toISOString()) // fixed while the screen is open
  const delivered = new Map(
    game.reports.filter((r) => r.kind === 'delivery' && r.status !== 'rejected').map((r) => [r.findId, r]),
  )
  const shown = game.reports.filter((r) => r.kind !== 'delivery').reverse()
  if (shown.length === 0) return <p className="text-sm text-ink-3">Du har ikke rapportert noe ennå.</p>
  return (
    <ul className="divide-y divide-line">
      {shown.map((r) => {
        const delivery = delivered.get(r.id)
        const canDeliver = r.kind === 'find' && deliveryBlock(r, game.reports, now) === null
        return (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <Thumb photoId={r.photoId} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="truncate font-medium">{reportTitle(r)}</div>
              <div className="text-xs text-ink-3">
                {formatDateTime(r.time)} · {linesTotal(r.lines)} poeng
                {delivery && ` · levert ${delivery.kg ?? 0} kg (+${linesTotal(delivery.lines)})`}
              </div>
            </div>
            {canDeliver ? (
              <button type="button" onClick={() => onDeliver(r.id)} className="h-9 shrink-0 rounded-full bg-surface-2 px-3 text-xs font-semibold">
                Levert? +{POINTS.delivery}
              </button>
            ) : (
              <StatusChip status={r.status} />
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function Report({ game, index, gear, coast, onShowOnMap }: Props) {
  const [flow, setFlow] = useState<Flow>({ step: 'menu' })
  const menu = () => setFlow({ step: 'menu' })

  if (flow.step === 'camera') {
    return (
      <Camera
        title={CAMERA_TITLE[flow.kind]}
        onCancel={menu}
        onCapture={(shot) => setFlow({ step: 'details', kind: flow.kind, shot, findId: flow.findId })}
      />
    )
  }
  if (flow.step === 'details') {
    return (
      <Details
        flow={flow}
        game={game}
        index={index}
        gear={gear}
        coast={coast}
        onSubmitted={(report) => setFlow({ step: 'result', report })}
        onCancel={menu}
      />
    )
  }
  if (flow.step === 'result') {
    const { report } = flow
    return <Result report={report} onMap={() => onShowOnMap([report.pos.lat, report.pos.lng])} onDone={menu} />
  }

  return (
    <>
      {!game.saved && (
        <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-900">
          Nettleseren lar ikke appen lagre noe (privat modus?). Rapportene forsvinner når du lukker siden.
        </p>
      )}
      <div className="grid gap-2">
        {ACTIONS.map((a) => (
          <button
            key={a.kind}
            type="button"
            disabled={!game.loaded} // checks need the stored history
            onClick={() => setFlow({ step: 'camera', kind: a.kind })}
            className="rounded-2xl border border-line p-3 text-left active:bg-surface-2 disabled:opacity-50"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{a.title}</span>
              <span className="shrink-0 text-sm font-semibold text-accent">{a.points}</span>
            </span>
            <span className="mt-0.5 block text-sm text-ink-2">{a.text}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-3">
        Bilder tas i appen og merkes med GPS-posisjon og tidspunkt. Alt lagres bare på denne enheten.
      </p>
      <section>
        <h3 className="mb-1 text-sm font-semibold">Mine rapporter</h3>
        <MyReports game={game} onDeliver={(findId) => setFlow({ step: 'camera', kind: 'delivery', findId })} />
      </section>
    </>
  )
}
