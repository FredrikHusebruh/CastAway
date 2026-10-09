import { describe, expect, it } from 'vitest'
import {
  type Draft,
  type Report,
  DAILY_CAP,
  POINTS,
  badges,
  currentStreak,
  deliveryBlock,
  evaluate,
  moderate,
  seasonKey,
  streakBonuses,
  totals,
  weekKey,
} from './rules'

const POS = { lat: 70.07, lng: 29.75, accuracy: 10 }
let n = 0

function draft(over: Partial<Draft> = {}): Draft {
  n++
  return { id: `r${n}`, photoId: `r${n}`, kind: 'find', time: '2026-10-09T10:00:00Z', pos: POS, gearType: 'nets', ...over }
}

/** Evaluate and append, as the store does. */
function add(history: Report[], d: Draft, coast: 'near' | 'far' | 'unknown' = 'near'): Report {
  const r = { ...d, ...evaluate(d, history, coast) }
  history.push(r)
  return r
}

const points = (r: Report) => r.lines.reduce((s, l) => s + l.points, 0)
const approved = (r: Report): Report => ({ ...r, status: 'approved', reasons: [] })
// moves a position ~1 km north per step, so finds don't count as duplicates or spam
const at = (k: number) => ({ ...POS, lat: POS.lat + 0.009 * k })

describe('evaluate', () => {
  it('gives base points plus hotspot, match and first-on-stretch bonuses', () => {
    const r = add([], draft({ hotspot: true, matchedLostId: 'bw-1', stretch: 's1' }))
    expect(points(r)).toBe(POINTS.find + POINTS.hotspot + POINTS.match + POINTS.firstOnStretch)
    expect(r.status).toBe('pending') // new user
  })

  it('gives the stretch bonus only to the first find there in a season', () => {
    const h: Report[] = []
    add(h, draft({ stretch: 's1', pos: at(0) }))
    expect(points(add(h, draft({ stretch: 's1', pos: at(3), gearType: 'longline' })))).toBe(POINTS.find)
    expect(points(add(h, draft({ stretch: 's1', pos: at(6), time: '2027-01-02T10:00:00Z' })))).toBe(
      POINTS.find + POINTS.firstOnStretch,
    )
  })

  it('merges a duplicate: same gear type within 200 m and 48 h', () => {
    const h: Report[] = []
    const first = add(h, draft())
    const dup = add(h, draft({ time: '2026-10-10T09:00:00Z', pos: { ...POS, lat: POS.lat + 0.001 } }))
    expect(dup.duplicateOf).toBe(first.id)
    expect(points(dup)).toBe(POINTS.duplicate)
    // another gear type at the same spot is a different item
    expect(add(h, draft({ gearType: 'crab_pot', time: '2026-10-10T09:30:00Z' })).duplicateOf).toBeUndefined()
    // after 48 h it is a new find
    expect(add(h, draft({ time: '2026-10-12T11:00:00Z' })).duplicateOf).toBeUndefined()
  })

  it('rejects more than 3 finds from the same spot within an hour', () => {
    const h: Report[] = []
    for (const gearType of ['nets', 'longline', 'crab_pot']) add(h, draft({ gearType }))
    const fourth = add(h, draft({ gearType: 'fish_pot' }))
    expect(fourth.status).toBe('rejected')
    expect(fourth.reasons[0]).toMatch(/samme sted/)
  })

  it('rejects finds far from the coast and inaccurate GPS', () => {
    expect(add([], draft(), 'far').status).toBe('rejected')
    expect(add([], draft({ pos: { ...POS, accuracy: 500 } })).status).toBe('rejected')
  })

  it('keeps reports outside the forecast area pending, even for trusted users', () => {
    const h = [1, 2, 3].map((k) => approved({ ...draft({ pos: at(k * 3) }), status: 'pending', lines: [], reasons: [] }))
    expect(add(h, draft({ pos: at(20) }), 'near').status).toBe('approved')
    const outside = add(h, draft({ pos: at(30) }), 'unknown')
    expect(outside.status).toBe('pending')
    expect(outside.reasons[0]).toMatch(/prognoseområdet/)
  })

  it('caps points per day', () => {
    const h: Report[] = []
    add(h, draft({ kind: 'cleanup', group: 'Klasse 9B', participants: 9, pos: at(0) })) // 90
    const r = add(h, draft({ hotspot: true, pos: at(5) })) // 15, only 10 left
    expect(points(r)).toBe(DAILY_CAP - 90)
    expect(r.lines.at(-1)?.label).toMatch(/dagstaket/)
    // the next day starts again
    expect(points(add(h, draft({ time: '2026-10-10T10:00:00Z', pos: at(10) })))).toBe(POINTS.find)
  })

  it('scores clean-ups per participant (max 50) and needs a group name', () => {
    expect(points(add([], draft({ kind: 'cleanup', group: 'Vadsø IL', participants: 4 })))).toBe(40)
    expect(add([], draft({ kind: 'cleanup', group: ' ', participants: 4 })).status).toBe('rejected')
    const big = add([], draft({ kind: 'cleanup', group: 'Alle', participants: 80 }))
    expect(big.lines[0].label).toMatch(/50 deltakere/)
  })

  it('allows "nothing here" once per hotspot cell per day', () => {
    const h: Report[] = []
    expect(add(h, draft({ kind: 'nothing', hotspot: false, cellId: 'c1' })).status).toBe('rejected')
    expect(points(add(h, draft({ kind: 'nothing', hotspot: true, cellId: 'c1' })))).toBe(POINTS.nothing)
    expect(add(h, draft({ kind: 'nothing', hotspot: true, cellId: 'c1' })).status).toBe('rejected')
    expect(add(h, draft({ kind: 'nothing', hotspot: true, cellId: 'c2' })).status).toBe('pending')
  })

  it('accepts one delivery per find within 14 days, even away from the coast', () => {
    const h: Report[] = []
    const find = add(h, draft())
    const delivery = { kind: 'delivery' as const, findId: find.id, kg: 30, time: '2026-10-11T10:00:00Z' }
    expect(points(add(h, draft(delivery), 'far'))).toBe(POINTS.delivery)
    expect(add(h, draft(delivery)).status).toBe('rejected')
    const late = add([find], draft({ ...delivery, time: '2026-10-30T10:00:00Z' }))
    expect(late.status).toBe('rejected')
    // a merged duplicate is the same item: it is handed in through the first report
    const dup = add(h, draft({ time: '2026-10-09T11:00:00Z' }))
    expect(dup.duplicateOf).toBe(find.id)
    expect(add(h, draft({ ...delivery, findId: dup.id })).status).toBe('rejected')
  })

  it('approves directly once the user has 3 approved reports', () => {
    const h: Report[] = []
    for (let k = 0; k < 3; k++) h.push(approved(add([], draft({ pos: at(k * 3) }))))
    expect(add(h, draft({ pos: at(12) })).status).toBe('approved')
  })
})

describe('moderate', () => {
  it('approves or rejects only pending reports', () => {
    const h: Report[] = []
    const r = add(h, draft())
    const ok = moderate(h, r.id, 'approved')
    expect(ok[0].status).toBe('approved')
    expect(moderate(ok, r.id, 'rejected')).toBe(ok) // already decided
  })

  it('promotes the first merged duplicate when a find is rejected', () => {
    const h: Report[] = []
    const a = add(h, draft({ hotspot: true, stretch: 's1' }))
    const b = add(h, draft({ time: '2026-10-09T11:00:00Z', hotspot: true, stretch: 's1' }))
    const c = add(h, draft({ time: '2026-10-09T12:00:00Z', hotspot: true, stretch: 's1' }))
    add(h, draft({ kind: 'delivery', findId: a.id, kg: 20, time: '2026-10-09T13:00:00Z' }))
    expect([b.duplicateOf, c.duplicateOf]).toEqual([a.id, a.id])

    const next = moderate(h, a.id, 'rejected')
    const [nb, nc, nd] = [1, 2, 3].map((k) => next[k])
    expect(nb.duplicateOf).toBeUndefined()
    expect(points(nb)).toBe(POINTS.find + POINTS.hotspot + POINTS.firstOnStretch) // full points now
    expect(nc.duplicateOf).toBe(b.id)
    expect(nd.findId).toBe(b.id) // the delivery follows the item
    expect(deliveryBlock(nb, next, '2026-10-10T10:00:00Z')).toMatch(/allerede levert/)
    // a new report of the same item is still merged
    expect(add(next, draft({ time: '2026-10-09T14:00:00Z', pos: at(0.01) })).duplicateOf).toBe(b.id)
  })

  it('rejects the delivery of a rejected find without duplicates', () => {
    const h: Report[] = []
    const a = add(h, draft())
    add(h, draft({ kind: 'delivery', findId: a.id, kg: 5, time: '2026-10-10T10:00:00Z' }))
    expect(moderate(h, a.id, 'rejected')[1].status).toBe('rejected')
  })
})

describe('seasons, streaks, totals, badges', () => {
  it('splits seasons by quarter and weeks by ISO week', () => {
    expect(seasonKey('2026-10-09T10:00:00Z')).toBe('2026-Q4')
    expect(seasonKey('2026-09-30T10:00:00Z')).toBe('2026-Q3')
    expect(weekKey('2026-10-09T10:00:00Z')).toBe('2026-W41')
    expect(weekKey('2027-01-01T10:00:00Z')).toBe('2026-W53')
  })

  it('adds a streak bonus per week with an approved action and counts only approved points', () => {
    const h: Report[] = [
      approved(add([], draft({ time: '2026-10-01T10:00:00Z' }))), // W40
      approved(add([], draft({ time: '2026-10-08T10:00:00Z' }))), // W41
    ]
    add(h, draft({ time: '2026-10-09T12:00:00Z', pos: at(9) })) // pending (only 2 approved: not trusted yet)
    expect(streakBonuses(h)).toHaveLength(2)
    expect(currentStreak(h, '2026-10-09T12:00:00Z')).toBe(2)
    expect(currentStreak(h, '2026-10-30T12:00:00Z')).toBe(0)
    const t = totals(h, '2026-Q4')
    expect(t.approved).toBe(points(h[0]) + points(h[1]) + 2 * POINTS.streakWeek)
    expect(t.pending).toBe(POINTS.find)
    expect(totals(h, '2026-Q3').approved).toBe(0)
  })

  it('awards badges from approved reports only', () => {
    const find = approved(add([], draft({ matchedLostId: 'bw-1', hotspot: true })))
    const delivery = approved(add([find], draft({ kind: 'delivery', findId: find.id, kg: 120, time: '2026-10-10T10:00:00Z' })))
    const earned = badges([find, delivery]).filter((b) => b.earned).map((b) => b.id)
    expect(earned).toEqual(['first-net', 'kg-100', 'confirmed-loss'])
    expect(badges([{ ...find, status: 'pending' }]).some((b) => b.earned)).toBe(false)
  })
})
