// Display text for reports (Norwegian, like the rest of the app).
import { gearLabel } from '../format'
import type { Report } from './rules'

/** "Funnet: garn", "Ryddeaksjon: Vadsø IL", ... */
export function reportTitle(r: Report): string {
  switch (r.kind) {
    case 'find':
      return `Funnet: ${gearLabel(r.gearType ?? 'unknown').toLowerCase()}`
    case 'nothing':
      return 'Sjekket – ingenting her'
    case 'cleanup':
      return `Ryddeaksjon: ${r.group ?? ''}`
    case 'delivery':
      return `Levert${r.kg ? ` (${r.kg} kg)` : ''}`
  }
}
