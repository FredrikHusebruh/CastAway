import { useState } from 'react'
import { DEMO_PLAYERS, TEAM_TYPES } from '../game/demo'
import {
  COAST_MAX_KM,
  DAILY_CAP,
  DUPLICATE_H,
  DUPLICATE_M,
  MAX_PARTICIPANTS,
  POINTS,
  TRUSTED_AFTER,
  seasonKey,
  seasonLabel,
  totals,
} from '../game/rules'
import type { Game } from '../game/store'

type Board = 'personer' | 'lag' | 'kommuner'
type Period = 'season' | 'total'

interface Row {
  key: string
  name: string
  sub: string
  points: number
  me: boolean
  demo: boolean
}

const BOARDS: { board: Board; label: string }[] = [
  { board: 'personer', label: 'Personer' },
  { board: 'lag', label: 'Lag' },
  { board: 'kommuner', label: 'Kommuner' },
]

const teamTypeLabel = (t: string) => TEAM_TYPES.find((x) => x.type === t)?.label ?? ''

function Segments<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-surface-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-9 flex-1 rounded-full text-sm font-medium transition-colors duration-200 ${
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Sums rows by a key (team or municipality); rows without one are left out. */
function group(rows: (Row & { by: string; byType?: string })[]): Row[] {
  const out = new Map<string, Row>()
  for (const r of rows) {
    if (!r.by) continue
    const cur = out.get(r.by) ?? { key: r.by, name: r.by, sub: '', points: 0, me: false, demo: true }
    cur.points += r.points
    cur.me ||= r.me
    cur.demo &&= r.demo
    if (r.byType) cur.sub = teamTypeLabel(r.byType)
    out.set(r.by, cur)
  }
  return [...out.values()]
}

export default function Leaderboard({ game }: { game: Game }) {
  const [board, setBoard] = useState<Board>('personer')
  const [period, setPeriod] = useState<Period>('season')
  const [season] = useState(() => seasonKey(new Date().toISOString())) // fixed while the screen is open
  const mine = totals(game.reports, period === 'season' ? season : null)
  const { profile } = game

  const people = [
    ...DEMO_PLAYERS.map((p) => ({
      key: p.name,
      name: p.name,
      sub: [p.team, p.kommune].filter(Boolean).join(' · '),
      points: period === 'season' ? p.season : p.total,
      me: false,
      demo: true,
      team: p.team,
      teamType: p.teamType as string,
      kommune: p.kommune,
    })),
    {
      key: 'me',
      name: profile.name.trim() || 'Deg',
      sub: [profile.team, profile.kommune].filter(Boolean).join(' · '),
      points: mine.approved,
      me: true,
      demo: false,
      team: profile.team.trim(),
      teamType: profile.teamType as string,
      kommune: profile.kommune.trim(),
    },
  ]
  const rows: Row[] =
    board === 'personer'
      ? people
      : board === 'lag'
        ? group(people.map((p) => ({ ...p, by: p.team, byType: p.teamType })))
        : group(people.map((p) => ({ ...p, by: p.kommune })))
  rows.sort((a, b) => b.points - a.points || Number(b.me) - Number(a.me))
  const missing =
    (board === 'lag' && !profile.team.trim()) || (board === 'kommuner' && !profile.kommune.trim())

  return (
    <>
      <p className="rounded-xl bg-amber-100 px-3 py-2 text-xs text-amber-900">
        <strong>Demo-tavle:</strong> poengene dine lagres bare på denne enheten. De andre deltakerne er oppdiktet
        (merket «Demo»).
      </p>
      <Segments label="Toppliste for" value={board} onChange={setBoard} options={BOARDS.map((b) => ({ value: b.board, label: b.label }))} />
      <Segments
        label="Periode"
        value={period}
        onChange={setPeriod}
        options={[
          { value: 'season', label: `Sesong ${seasonLabel(season)}` },
          { value: 'total', label: 'Totalt' },
        ]}
      />
      {missing && (
        <p className="text-xs text-ink-3">
          Velg {board === 'lag' ? 'lag' : 'kommune'} i Profil for å telle med her.
        </p>
      )}
      <ol className="divide-y divide-line">
        {rows.map((r, k) => (
          <li
            key={r.key}
            className={`flex min-h-12 items-center gap-3 px-2 py-2 text-sm ${r.me ? 'rounded-xl bg-accent/10 font-semibold' : ''}`}
            aria-current={r.me ? 'true' : undefined}
          >
            <span className="w-6 shrink-0 text-right tabular-nums text-ink-3">{k + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate">{r.name}</span>
                {r.me && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] text-white">Du</span>}
                {r.demo && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-3">Demo</span>}
              </span>
              {r.sub && <span className="block truncate text-xs font-normal text-ink-3">{r.sub}</span>}
              {r.me && board === 'personer' && mine.pending > 0 && (
                <span className="block text-xs font-normal text-amber-700">+{mine.pending} foreløpige poeng venter på godkjenning</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">{r.points}</span>
          </li>
        ))}
      </ol>

      <details className="rounded-2xl border border-line p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Slik får du poeng</summary>
        <table className="mt-2 w-full text-left">
          <tbody className="divide-y divide-line">
            {[
              ['Rapportere funnet redskap (bilde + GPS + type)', `${POINTS.find}`],
              ['… funnet i et varslet hotspot (middels sannsynlighet eller mer)', `+${POINTS.hotspot}`],
              ['… som matcher et innmeldt tap fra BarentsWatch', `+${POINTS.match}`],
              ['Fjerne og levere redskapet (bilde ved mottak)', `+${POINTS.delivery}`],
              ['«Sjekket – ingenting her» i et hotspot', `${POINTS.nothing}`],
              [`Ryddeaksjon (per deltaker, maks ${MAX_PARTICIPANTS})`, `${POINTS.perParticipant}`],
              ['Første funn på en kyststrekning denne sesongen', `+${POINTS.firstOnStretch}`],
              ['Hver uke med minst én godkjent handling', `+${POINTS.streakWeek}`],
            ].map(([what, pts]) => (
              <tr key={what}>
                <td className="py-1.5 pr-2 text-ink-2">{what}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">{pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h4 className="mt-3 font-semibold">Slik sjekkes det</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
          <li>Bildet må tas i appen (ikke fra galleriet) og får GPS-posisjon og tidspunkt.</li>
          <li>Funn mer enn {COAST_MAX_KM} km fra kysten, eller mange funn fra samme sted på kort tid, avvises.</li>
          <li>
            Nye brukere får foreløpige poeng til en moderator godkjenner dem. Etter {TRUSTED_AFTER} godkjente rapporter
            går rapportene rett gjennom.
          </li>
          <li>
            Samme redskap innen {DUPLICATE_M} m og {DUPLICATE_H} timer slås sammen; bare den første rapporten får fulle
            poeng.
          </li>
          <li>Maks {DAILY_CAP} poeng per dag.</li>
          <li>Sesongen nullstilles hvert kvartal; totalen beholdes.</li>
        </ul>
      </details>
    </>
  )
}
