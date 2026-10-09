import { useState } from 'react'
import { PointLines, StatusChip } from '../components/Points'
import { formatDateTime } from '../format'
import { KOMMUNER, TEAM_TYPES } from '../game/demo'
import { reportTitle } from '../game/labels'
import { TRUSTED_AFTER, badges, currentStreak, isTrusted, seasonKey, seasonLabel, totals } from '../game/rules'
import { type Game, type TeamType, usePhoto } from '../game/store'

const field = 'mt-1 h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm font-normal text-ink'

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3">
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-ink-3">{label}</div>
    </div>
  )
}

function PendingReport({ game, id }: { game: Game; id: string }) {
  const r = game.reports.find((x) => x.id === id)
  const url = usePhoto(r?.photoId)
  if (!r) return null
  return (
    <li className="space-y-2 py-3">
      <div className="flex items-center gap-3">
        {url ? <img src={url} alt="" className="h-16 w-16 rounded-lg object-cover" /> : <span className="h-16 w-16 rounded-lg bg-surface-2" />}
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">{reportTitle(r)}</div>
          <div className="text-xs text-ink-3">
            {formatDateTime(r.time)} · {r.pos.lat.toFixed(4)}°N {r.pos.lng.toFixed(4)}°Ø
          </div>
        </div>
        <StatusChip status={r.status} />
      </div>
      <PointLines lines={r.lines} />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => game.moderate(r.id, 'rejected')}
          className="h-10 flex-1 rounded-xl border border-line text-sm font-semibold text-red-700 active:bg-surface-2"
        >
          Avvis
        </button>
        <button
          type="button"
          onClick={() => game.moderate(r.id, 'approved')}
          className="h-10 flex-1 rounded-xl bg-emerald-700 text-sm font-semibold text-white active:opacity-80"
        >
          Godkjenn
        </button>
      </div>
    </li>
  )
}

export default function Profile({ game }: { game: Game }) {
  const { profile, reports } = game
  const [now] = useState(() => new Date().toISOString()) // fixed while the screen is open
  const season = seasonKey(now)
  const inSeason = totals(reports, season)
  const allTime = totals(reports, null)
  const streak = currentStreak(reports, now)
  const trusted = isTrusted(reports)
  const nApproved = reports.filter((r) => r.status === 'approved').length
  const pending = reports.filter((r) => r.status === 'pending')
  const set = (patch: Partial<typeof profile>) => game.setProfile({ ...profile, ...patch })

  return (
    <>
      <section className="grid gap-3">
        <label className="text-sm font-semibold">
          Navn på topplisten
          <input className={field} value={profile.name} onChange={(e) => set({ name: e.target.value })} placeholder="F.eks. Kari N." maxLength={40} />
        </label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="text-sm font-semibold">
            Lag
            <input className={field} value={profile.team} onChange={(e) => set({ team: e.target.value })} placeholder="Klasse, lag eller bedrift" maxLength={60} />
          </label>
          <label className="text-sm font-semibold">
            Type
            <select className={field} value={profile.teamType} onChange={(e) => set({ teamType: e.target.value as TeamType })}>
              {TEAM_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="text-sm font-semibold">
          Kommune
          <input className={field} list="kommuner" value={profile.kommune} onChange={(e) => set({ kommune: e.target.value })} placeholder="Velg eller skriv" maxLength={40} />
          <datalist id="kommuner">
            {KOMMUNER.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        </label>
      </section>

      <section className="grid grid-cols-2 gap-2">
        <Stat label={`Poeng sesong ${seasonLabel(season)}`} value={inSeason.approved} />
        <Stat label="Poeng totalt" value={allTime.approved} />
        <Stat label="Foreløpige poeng" value={allTime.pending} />
        <Stat label={`Uke${streak === 1 ? '' : 'r'} på rad`} value={streak} />
      </section>

      <p className={`rounded-xl px-3 py-2 text-sm ${trusted ? 'bg-emerald-100 text-emerald-900' : 'bg-surface-2 text-ink-2'}`}>
        {trusted
          ? 'Pålitelig rapportør: nye rapporter godkjennes med en gang.'
          : `Ny rapportør: poengene er foreløpige til de er godkjent (${nApproved}/${TRUSTED_AFTER} godkjente rapporter).`}
      </p>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Merker</h3>
        <ul className="grid grid-cols-2 gap-2">
          {badges(reports).map((b) => (
            <li
              key={b.id}
              className={`rounded-2xl border p-3 ${b.earned ? 'border-accent bg-accent/10' : 'border-line opacity-60'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{b.name}</span>
                <span aria-hidden="true">{b.earned ? '★' : '☆'}</span>
              </div>
              <div className="mt-0.5 text-xs text-ink-3">{b.text}</div>
              {!b.earned && b.progress && <div className="mt-1 text-xs font-medium tabular-nums text-ink-2">{b.progress}</div>}
              <span className="sr-only">{b.earned ? 'Oppnådd' : 'Ikke oppnådd ennå'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-dashed border-amber-400 p-3">
        <h3 className="text-sm font-semibold">
          Demo-moderator <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-900">Demo</span>
        </h3>
        <p className="mt-0.5 text-xs text-ink-3">
          I en ekte versjon godkjenner en moderator eller en annen bruker funnene. Her kan du prøve det selv.
        </p>
        {pending.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">Ingen rapporter venter på godkjenning.</p>
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((r) => (
              <PendingReport key={r.id} game={game} id={r.id} />
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={() => {
          if (window.confirm('Slette alle rapporter, bilder og profilen din fra denne enheten?')) void game.resetAll()
        }}
        className="h-11 rounded-xl border border-line text-sm font-semibold text-red-700 active:bg-surface-2"
      >
        Slett alle mine data
      </button>
      <p className="-mt-2 text-center text-xs text-ink-3">Alt lagres bare på denne enheten. Ingenting lastes opp.</p>
    </>
  )
}
