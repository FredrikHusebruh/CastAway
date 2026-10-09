// Map icons for lost gear, one per gear type: a round badge with a white pictogram (pot = cage, gillnet = mesh,
// long line = hook, seine = net with floats, sensor/cable = cable, other/unknown = plastic bottle). Drawn on a canvas
// from SVG path data (Path2D), so they need no image files and work synchronously when a map style loads.
import { MAP_COLORS } from './mapStyle'

const VIEW = 24 // pictograms are drawn in a 24 x 24 box
const RATIO = 2 // canvas pixels per logical pixel: sharp on retina screens

interface Glyph {
  stroke: string // SVG path data, stroked white
  fill?: string // SVG path data, filled white (e.g. floats)
}

const POT: Glyph = { stroke: 'M7 10h10v7.5H7z M7 10l2.2-3h5.6L17 10 M10.3 10v7.5 M13.7 10v7.5 M7 13.75h10' }

const GLYPHS: Record<string, Glyph> = {
  crab_pot: POT,
  fish_pot: {
    stroke: 'M6.5 8h11v9.5h-11z M8.6 12.75c1.6-1.8 3.9-1.8 5.4 0c-1.5 1.8-3.8 1.8-5.4 0z M14 12.75l1.9-1.3v2.6z',
  },
  nets: { stroke: 'M7 7l10 10 M7 12l5 5 M12 7l5 5 M17 7L7 17 M12 7l-5 5 M17 12l-5 5' },
  longline: { stroke: 'M13 5.5v8.5a3.2 3.2 0 0 1-6.4 0v-1.6 M6.6 12.4l1.8 1.6 M11 5.5h4' },
  seine: {
    stroke: 'M5 8h14 M7.5 8v7.5 M12 8v8.5 M16.5 8v7.5 M7.5 11.75h9 M7.5 15.5c2.8 1.6 6.2 1.6 9 0',
    fill: 'M8.9 8a1.4 1.4 0 1 1-2.8 0a1.4 1.4 0 1 1 2.8 0z M13.4 8a1.4 1.4 0 1 1-2.8 0a1.4 1.4 0 1 1 2.8 0z M17.9 8a1.4 1.4 0 1 1-2.8 0a1.4 1.4 0 1 1 2.8 0z',
  },
  sensor_cable: { stroke: 'M5 14.5c2.3 0 2.7-5 5-5s2.7 5 5 5h1.2 M16.2 12h3v5h-3z M19.2 13.25h1.3 M19.2 15.75h1.3' },
  generic: { stroke: 'M10.6 5h2.8v2l1.6 2.2v9.3a1 1 0 0 1-1 1H10a1 1 0 0 1-1-1V9.2l1.6-2.2z M9 12.5h6' },
}
GLYPHS.unknown = GLYPHS.generic

/** The gear types that have an icon; any other type is drawn as 'generic'. */
export const GEAR_ICON_TYPES = Object.keys(GLYPHS)

/** Map image name of a gear type's icon (selected = the bigger, highlighted variant). */
export const gearIconName = (type: string, selected: boolean) => `gear-${type}${selected ? '-sel' : ''}`

/** One icon as a canvas: badge (dark, or violet when selected) with a white ring and the type's pictogram. */
function drawIcon(type: string, selected: boolean): HTMLCanvasElement {
  const glyph = GLYPHS[type] ?? GLYPHS.generic
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = VIEW * RATIO
  const ctx = canvas.getContext('2d')!
  ctx.scale(RATIO, RATIO)
  ctx.beginPath()
  ctx.arc(VIEW / 2, VIEW / 2, VIEW / 2 - 1, 0, Math.PI * 2)
  ctx.fillStyle = selected ? MAP_COLORS.selectedFill : MAP_COLORS.gearFill
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = selected ? MAP_COLORS.selectedStroke : MAP_COLORS.gearStroke
  ctx.stroke()
  ctx.strokeStyle = '#ffffff'
  ctx.fillStyle = '#ffffff'
  ctx.lineWidth = 1.6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(glyph.stroke))
  if (glyph.fill) ctx.fill(new Path2D(glyph.fill))
  return canvas
}

/** Every gear icon (normal and selected) for map.addImage, with its pixel ratio. */
export function gearIconImages(): { name: string; image: ImageData; pixelRatio: number }[] {
  return GEAR_ICON_TYPES.flatMap((type) =>
    [false, true].map((selected) => {
      const canvas = drawIcon(type, selected)
      const image = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height)
      return { name: gearIconName(type, selected), image, pixelRatio: RATIO }
    }),
  )
}

const urlCache = new Map<string, string>()
/** A gear type's icon as an image URL, for the legend and cards. */
export function gearIconUrl(type: string): string {
  let url = urlCache.get(type)
  if (!url) {
    url = drawIcon(type, false).toDataURL('image/png')
    urlCache.set(type, url)
  }
  return url
}
