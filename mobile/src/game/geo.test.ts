import { describe, expect, it } from 'vitest'
import type { CellCollection, CellFeature, CoastInfo, GearCollection } from '../api'
import { coastCheck, coastSet, forecastDateFor, hotspotAt, matchCandidates, stretchKey } from './geo'

const DLAT = 1 / 111.32
const DLON = DLAT / Math.cos((70 * Math.PI) / 180)
const BBOX: [number, number, number, number] = [25, 69.6, 31.5, 71.3]
const BREAKS = [0.001, 0.003, 0.01, 0.03]

function cell(i: number, j: number, expected: number, ids: string[]): CellFeature {
  const [w, s] = [i * DLON, j * DLAT]
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[w, s], [w + DLON, s], [w + DLON, s + DLAT], [w, s + DLAT], [w, s]]] },
    properties: { cell_id: `${i}_${j}`, expected_nets: expected, particle_count: 3, n_nets: ids.length, contributing_net_ids: ids },
  }
}

// a point in the middle of cell (i, j)
const mid = (i: number, j: number) => ({ lat: (j + 0.5) * DLAT, lng: (i + 0.5) * DLON })
const I = Math.floor(29.75 / DLON)
const J = Math.floor(70.07 / DLAT)

describe('coastCheck', () => {
  const coast: CoastInfo = { cell_deg: [DLON, DLAT], cells: [[I, J]] }
  const cells = coastSet(coast)
  it('is near within 2 km of a coast cell, far beyond, unknown outside the area', () => {
    expect(coastCheck(mid(I, J), coast, cells, BBOX)).toBe('near')
    expect(coastCheck(mid(I, J + 2), coast, cells, BBOX)).toBe('near')
    expect(coastCheck(mid(I, J + 6), coast, cells, BBOX)).toBe('far')
    expect(coastCheck({ lat: 58.1, lng: 8 }, coast, cells, BBOX)).toBe('unknown')
    expect(coastCheck(mid(I, J), null, null, BBOX)).toBe('unknown')
  })
})

describe('hotspotAt', () => {
  const fc: CellCollection = {
    type: 'FeatureCollection',
    features: [cell(I, J, 0.005, ['a']), cell(I + 3, J, 0.002, ['b'])],
  }
  it('uses the cell under the point and the medium class break', () => {
    expect(hotspotAt(mid(I, J), fc, BREAKS)).toMatchObject({ hotspot: true })
    expect(hotspotAt(mid(I + 3, J), fc, BREAKS)).toMatchObject({ hotspot: false })
  })
  it('falls back to the nearest cell within 1 km', () => {
    expect(hotspotAt(mid(I, J + 1), fc, BREAKS).cell?.properties.cell_id).toBe(`${I}_${J}`)
    expect(hotspotAt(mid(I, J + 5), fc, BREAKS)).toEqual({ cell: null, hotspot: false })
  })
})

describe('matchCandidates', () => {
  const fc: CellCollection = { type: 'FeatureCollection', features: [cell(I, J, 0.01, ['a', 'b', 'c'])] }
  const gear: GearCollection = {
    type: 'FeatureCollection',
    features: [
      ['a', 'nets', 30.5],
      ['b', 'crab_pot', 30.0],
      ['c', 'nets', 29.9],
      ['d', 'nets', 29.8], // not forecast to strand here
    ].map(([id, gear_type, lng]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng as number, 70.2] },
      properties: { id: id as string, gear_type: gear_type as string, lost_time: '2026-10-01T00:00:00Z', float_prob: 0.3 },
    })),
  }
  it('suggests items of the same type that strand nearby, nearest loss first', () => {
    expect(matchCandidates(mid(I, J), 'nets', fc, gear).map((c) => c.gear.id)).toEqual(['c', 'a'])
    expect(matchCandidates(mid(I, J + 10), 'nets', fc, gear)).toEqual([])
  })
})

describe('helpers', () => {
  it('gives nearby points on one stretch the same key', () => {
    expect(stretchKey({ lat: 70.0701, lng: 29.7501 })).toBe(stretchKey({ lat: 70.0702, lng: 29.7502 }))
    expect(stretchKey({ lat: 70.07, lng: 29.75 })).not.toBe(stretchKey({ lat: 70.17, lng: 29.75 }))
  })
  it('maps a day onto the forecast dates', () => {
    const dates = ['2026-10-04', '2026-10-05', '2026-10-06']
    expect(forecastDateFor('2026-10-05', dates)).toBe('2026-10-05')
    expect(forecastDateFor('2026-10-20', dates)).toBe('2026-10-06')
    expect(forecastDateFor('2026-09-01', dates)).toBe('2026-10-04')
  })
})
