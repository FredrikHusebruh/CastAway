// Made-up participants for the leaderboard. Reports are stored only on this device, so without these the
// board would hold just the user. They are ALWAYS labelled "Demo" in the UI (same idea as the TESTDATA badge).
import type { TeamType } from './store'

export interface DemoPlayer {
  name: string
  team: string
  teamType: TeamType
  kommune: string
  season: number // points this season
  total: number // all-time points
}

export const DEMO_PLAYERS: DemoPlayer[] = [
  { name: 'Ingrid S.', team: 'Kirkenes vgs 2STA', teamType: 'skoleklasse', kommune: 'Sør-Varanger', season: 245, total: 610 },
  { name: 'Mathias H.', team: 'Vadsø IL', teamType: 'idrettslag', kommune: 'Vadsø', season: 198, total: 455 },
  { name: 'Aisha K.', team: 'Varanger Dykk AS', teamType: 'bedrift', kommune: 'Vardø', season: 176, total: 390 },
  { name: 'Ola N.', team: 'Kirkenes vgs 2STA', teamType: 'skoleklasse', kommune: 'Sør-Varanger', season: 152, total: 152 },
  { name: 'Sara L.', team: 'Kristiansand Seilforening', teamType: 'idrettslag', kommune: 'Kristiansand', season: 140, total: 520 },
  { name: 'Jonas B.', team: 'Lindesnes ungdomsskole 9B', teamType: 'skoleklasse', kommune: 'Lindesnes', season: 121, total: 280 },
  { name: 'Emma T.', team: 'Vadsø IL', teamType: 'idrettslag', kommune: 'Vadsø', season: 104, total: 233 },
  { name: 'Nils P.', team: '', teamType: 'annet', kommune: 'Båtsfjord', season: 96, total: 96 },
  { name: 'Leah M.', team: 'Havrydd Agder AS', teamType: 'bedrift', kommune: 'Lillesand', season: 88, total: 341 },
  { name: 'Erik V.', team: 'Varanger Dykk AS', teamType: 'bedrift', kommune: 'Vardø', season: 73, total: 198 },
  { name: 'Mia R.', team: 'Lindesnes ungdomsskole 9B', teamType: 'skoleklasse', kommune: 'Lindesnes', season: 61, total: 61 },
  { name: 'Kristian O.', team: '', teamType: 'annet', kommune: 'Berlevåg', season: 45, total: 172 },
  { name: 'Hanna E.', team: 'Kristiansand Seilforening', teamType: 'idrettslag', kommune: 'Kristiansand', season: 38, total: 140 },
  { name: 'Tobias J.', team: '', teamType: 'annet', kommune: 'Grimstad', season: 22, total: 67 },
  { name: 'Selma A.', team: 'Nesseby skole 7A', teamType: 'skoleklasse', kommune: 'Nesseby', season: 15, total: 15 },
]

/** Coastal municipalities offered in the profile (any name can be typed). */
export const KOMMUNER = [
  'Sør-Varanger',
  'Nesseby',
  'Vadsø',
  'Vardø',
  'Båtsfjord',
  'Berlevåg',
  'Tana',
  'Kristiansand',
  'Lindesnes',
  'Lillesand',
  'Grimstad',
  'Arendal',
  'Farsund',
  'Bergen',
  'Øygarden',
  'Askøy',
  'Vågan',
  'Vestvågøy',
  'Flakstad',
  'Moskenes',
]

export const TEAM_TYPES: { type: TeamType; label: string }[] = [
  { type: 'skoleklasse', label: 'Skoleklasse' },
  { type: 'idrettslag', label: 'Idrettslag' },
  { type: 'bedrift', label: 'Bedrift' },
  { type: 'annet', label: 'Annet' },
]
