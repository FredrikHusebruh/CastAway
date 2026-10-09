// Turn gridded cell values into a smooth (bilinearly interpolated) image for a Leaflet ImageOverlay.
// Values are interpolated before colouring, so colours stay true to the scale. Rows are spaced in
// Web Mercator, so the image lines up with the basemap even at high latitudes.

export type RGBA = [number, number, number, number] // 0-255, alpha 0-1

export interface GridCell {
  lat: number // cell centre
  lon: number
  v: number
}

export interface Raster {
  url: string
  bounds: [[number, number], [number, number]] // [[south, west], [north, east]]
}

// Colour is drawn only where the smoothed "has data" mask exceeds SUPPORT_MIN, fading in over SUPPORT_FADE.
const SUPPORT_MIN = 0.08
const SUPPORT_FADE = 0.15

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
const invMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90

/** Separable Gaussian blur of a w x h grid (in place); sigma in grid pixels. */
function gaussianBlur(data: Float32Array, w: number, h: number, sigma: number): void {
  if (sigma <= 0) return
  const r = Math.ceil(sigma * 3)
  const kernel = Array.from({ length: 2 * r + 1 }, (_, k) => Math.exp(-((k - r) ** 2) / (2 * sigma * sigma)))
  const sum = kernel.reduce((a, b) => a + b, 0)
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum
  const tmp = new Float32Array(data.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w) acc += data[y * w + xx] * kernel[k + r]
      }
      tmp[y * w + x] = acc
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let k = -r; k <= r; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h) acc += tmp[yy * w + x] * kernel[k + r]
      }
      data[y * w + x] = acc
    }
}

/**
 * Smooth raster of cell values: bilinear upsampling, then a Gaussian blur of ``smoothCells`` cells (0 = none),
 * rescaled so the highest value is kept (smoothing would otherwise dim isolated hotspots), then coloured.
 */
export function buildRaster(
  cells: GridCell[],
  [dlon, dlat]: [number, number],
  colorAt: (v: number) => RGBA | null,
  { upsample = 6, smoothCells = 0.7 }: { upsample?: number; smoothCells?: number } = {},
): Raster | null {
  if (cells.length === 0) return null
  // value grid with padding, so blurred edges fade out inside the image
  const pad = 1 + Math.ceil(smoothCells * 3)
  const lon0 = Math.min(...cells.map((c) => c.lon)) - pad * dlon
  const lat0 = Math.min(...cells.map((c) => c.lat)) - pad * dlat
  const nx = Math.round((Math.max(...cells.map((c) => c.lon)) + pad * dlon - lon0) / dlon) + 1
  const ny = Math.round((Math.max(...cells.map((c) => c.lat)) + pad * dlat - lat0) / dlat) + 1
  const grid = new Float32Array(nx * ny)
  const occupied = new Float32Array(nx * ny) // 1 where a cell has a value: limits how far colour spreads
  let peak = 0
  for (const c of cells) {
    const i = Math.round((c.lon - lon0) / dlon)
    const j = Math.round((c.lat - lat0) / dlat)
    grid[j * nx + i] = Math.max(grid[j * nx + i], c.v)
    occupied[j * nx + i] = 1
    peak = Math.max(peak, c.v)
  }

  // 1) bilinear upsampling onto a fine grid, rows evenly spaced in latitude (row 0 = south)
  const width = nx * upsample
  const fineH = ny * upsample
  const upsampleGrid = (src: Float32Array): Float32Array => {
    const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= ny ? 0 : src[j * nx + i])
    const out = new Float32Array(width * fineH)
    for (let fy = 0; fy < fineH; fy++) {
      const gy = ((fy + 0.5) / fineH) * ny - 0.5
      const j0 = Math.floor(gy)
      const ty = gy - j0
      for (let px = 0; px < width; px++) {
        const gx = ((px + 0.5) / width) * nx - 0.5
        const i0 = Math.floor(gx)
        const tx = gx - i0
        out[fy * width + px] =
          at(i0, j0) * (1 - tx) * (1 - ty) +
          at(i0 + 1, j0) * tx * (1 - ty) +
          at(i0, j0 + 1) * (1 - tx) * ty +
          at(i0 + 1, j0 + 1) * tx * ty
      }
    }
    return out
  }
  const fine = upsampleGrid(grid)
  const support = upsampleGrid(occupied)
  // 2) Gaussian smoothing (values and support), then keep the original peak value
  gaussianBlur(fine, width, fineH, smoothCells * upsample)
  gaussianBlur(support, width, fineH, smoothCells * upsample)
  let finePeak = 0
  for (const v of fine) finePeak = Math.max(finePeak, v)
  const scale = finePeak > 0 ? peak / finePeak : 1

  // 3) colour into an image whose rows are evenly spaced in Web Mercator (matches the basemap)
  const west = lon0 - dlon / 2
  const east = lon0 + (nx - 0.5) * dlon
  const south = lat0 - dlat / 2
  const north = lat0 + (ny - 0.5) * dlat
  const yTop = mercY(north)
  const yBottom = mercY(south)
  const height = fineH
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(width, height)
  for (let py = 0; py < height; py++) {
    const lat = invMercY(yTop - ((py + 0.5) / height) * (yTop - yBottom))
    const fyf = ((lat - south) / (north - south)) * fineH - 0.5
    const r0 = Math.min(Math.max(Math.floor(fyf), 0), fineH - 1)
    const r1 = Math.min(r0 + 1, fineH - 1)
    const t = Math.min(Math.max(fyf - r0, 0), 1)
    for (let px = 0; px < width; px++) {
      const v = (fine[r0 * width + px] * (1 - t) + fine[r1 * width + px] * t) * scale
      const near = support[r0 * width + px] * (1 - t) + support[r1 * width + px] * t
      // only colour within ~1 cell of cells that have a value, fading out at the edge (no wide faint halos)
      if (near < SUPPORT_MIN || v <= 0) continue
      const rgba = colorAt(v)
      if (!rgba) continue
      rgba[3] *= Math.min(1, (near - SUPPORT_MIN) / SUPPORT_FADE)
      const o = (py * width + px) * 4
      img.data[o] = rgba[0]
      img.data[o + 1] = rgba[1]
      img.data[o + 2] = rgba[2]
      img.data[o + 3] = Math.round(rgba[3] * 255)
    }
  }
  ctx.putImageData(img, 0, 0)
  return {
    url: canvas.toDataURL('image/png'),
    bounds: [
      [south, west],
      [north, east],
    ],
  }
}

const hexToRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

/** Colour at position t (0-1) along evenly spaced hex stops, with alpha interpolated along ``alphas``. */
export function rampAt(stops: readonly string[], alphas: readonly number[], t: number): RGBA {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
  const k = Math.min(Math.floor(x), stops.length - 2)
  const f = x - k
  const [a, b] = [hexToRgb(stops[k]), hexToRgb(stops[k + 1])]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    alphas[k] + (alphas[k + 1] - alphas[k]) * f,
  ]
}

/** Position of ``v`` on a log scale between ``lo`` and ``hi`` (0-1). */
export function logPosition(v: number, lo: number, hi: number): number {
  return (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
}
