// Basemap: free OpenFreeMap vector tiles (OpenStreetMap data, no API key), drawn by MapLibre GL.
// Simple and made for the sea: a clear blue sea with a crisp coastline, soft natural colours on land (shaded relief
// when zoomed out, forest, tundra, bog, rock and ice when zoomed in) and place names. Roads, borders and buildings are
// hidden. Always light, also in dark mode: the viridis rasters and the dark gear dots read best on a light map.
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { ExpressionSpecification, LayerSpecification, Map as MLMap } from 'maplibre-gl'
import seaNames from './seaNames.json'

export const BASEMAP_URL = 'https://tiles.openfreemap.org/styles/positron'

/** Map colours; the data colours themselves come from format.ts. */
export const MAP_COLORS = {
  land: '#eef1e3',
  water: '#8ec3e6',
  coastline: '#4f8fbf',
  waterLabel: '#1d5a87',
  placeLabel: '#1f2933',
  islandLabel: '#3d4852',
  minorLabel: '#5b6670',
  labelHalo: '#ffffff',
  settlement: '#efe2d3',
  gearFill: '#1e293b',
  gearStroke: '#ffffff',
  selectedFill: '#440154', // also the pulse ring in index.css (--selected)
  selectedStroke: '#ffffff',
  userFill: '#2563eb',
  headStroke: '#ffffff',
}

// The basemap layers that stay visible (by id in the positron style); every other layer is hidden.
const KEEP = new Set([
  'background',
  'water',
  'waterway',
  'water_name_point_label',
  'water_name_line_label',
  'label_village',
  'label_town',
  'label_city',
  'label_city_capital',
  'label_country_1',
  'label_country_2',
  'label_country_3',
])

// Land colours by OpenMapTiles landcover class: muted, so the beaching colours along the coast stay the loudest thing.
const LANDCOVER_COLORS: Record<string, string> = {
  wood: '#c4ddb4',
  grass: '#dcebc9',
  farmland: '#e7ecc6',
  wetland: '#cde3d6',
  rock: '#e3dfd5',
  sand: '#f2e8cc',
  ice: '#fbfdff',
}

const LAND_LAYERS: LayerSpecification[] = [
  {
    // Natural Earth shaded relief (green lowlands, brown mountains), only when zoomed out; fades into the landcover
    id: 'relief',
    type: 'raster',
    source: 'ne2_shaded',
    paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.55, 6, 0.45, 8, 0], 'raster-saturation': -0.2 },
  },
  {
    id: 'landcover-colour',
    type: 'fill',
    source: 'openmaptiles',
    'source-layer': 'landcover',
    paint: {
      'fill-color': ['match', ['get', 'class'], ...Object.entries(LANDCOVER_COLORS).flat(), MAP_COLORS.land] as never,
      'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 8, 1],
    },
  },
  {
    id: 'settlement-colour',
    type: 'fill',
    source: 'openmaptiles',
    'source-layer': 'landuse',
    filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial'], true, false],
    paint: { 'fill-color': MAP_COLORS.settlement },
  },
]

const COASTLINE_LAYER: LayerSpecification = {
  id: 'coastline',
  type: 'line',
  source: 'openmaptiles',
  'source-layer': 'water',
  paint: {
    'line-color': MAP_COLORS.coastline,
    'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 8, 0.8, 12, 1.4],
  },
}

// --- names ------------------------------------------------------------------------------------------------------
// Norwegian names first ("Vadsø", not "Vadsø - Čáhcesuolu" or an English exonym), then the local name.
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:no'], ['get', 'name'], ['get', 'name_en']]
const zoomSize = (...stops: number[]): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...stops]

/** Restyled basemap labels, by layer id: bigger, sharper and Norwegian. */
const LABEL_STYLES: Record<string, { size: ExpressionSpecification; color: string; halo: number; spacing?: number }> = {
  water_name_point_label: { size: zoomSize(4, 11, 8, 13, 12, 16), color: MAP_COLORS.waterLabel, halo: 1.2, spacing: 0.15 },
  water_name_line_label: { size: zoomSize(8, 11.5, 12, 14.5), color: MAP_COLORS.waterLabel, halo: 1.2, spacing: 0.15 },
  label_village: { size: zoomSize(9, 11, 13, 14.5), color: MAP_COLORS.placeLabel, halo: 1.6 },
  label_town: { size: zoomSize(6, 11.5, 10, 14.5, 14, 18), color: MAP_COLORS.placeLabel, halo: 1.6 },
  label_city: { size: zoomSize(4, 12, 10, 16, 14, 20), color: MAP_COLORS.placeLabel, halo: 1.8 },
  label_city_capital: { size: zoomSize(4, 13, 10, 17, 14, 21), color: MAP_COLORS.placeLabel, halo: 1.8 },
}

// Names the stock style doesn't show: islands (from zoom 8, islets from 11) and small coastal places (from 11).
const NAME_LAYERS: LayerSpecification[] = [
  {
    id: 'label_island',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 8,
    filter: ['any', ['==', ['get', 'class'], 'island'], ['all', ['==', ['get', 'class'], 'islet'], ['>=', ['zoom'], 11]]],
    layout: {
      'text-field': NAME,
      'text-font': ['Noto Sans Italic'],
      'text-size': zoomSize(8, 10.5, 13, 14),
      'text-letter-spacing': 0.05,
      'text-max-width': 7,
    },
    paint: { 'text-color': MAP_COLORS.islandLabel, 'text-halo-color': MAP_COLORS.labelHalo, 'text-halo-width': 1.4 },
  },
  {
    id: 'label_coastal_place',
    type: 'symbol',
    source: 'openmaptiles',
    'source-layer': 'place',
    minzoom: 11,
    filter: ['match', ['get', 'class'], ['hamlet', 'isolated_dwelling', 'locality'], true, false],
    layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': zoomSize(11, 10.5, 14, 13), 'text-max-width': 7 },
    paint: { 'text-color': MAP_COLORS.minorLabel, 'text-halo-color': MAP_COLORS.labelHalo, 'text-halo-width': 1.4 },
  },
]

// Fjords, bays, sounds and seas: the OpenFreeMap tiles have no marine names here, so they come from OpenStreetMap via
// scripts/fetch-sea-names.mjs (src/seaNames.json). Each name shows from its own zoom: big fjords early, small bays late.
// Fjords mapped as a line along their axis get the name written along that line from LINE_NAMES_FROM_ZOOM; zoomed
// further out the line is too short for the name, so big ones show at their midpoint instead. The rest at a point.
type SeaName = [number, number, string, string, number, [number, number][]?]
const LINE_NAMES_FROM_ZOOM = 8
function seaNameFeatures([lon, lat, name, kind, minzoom, line]: SeaName): Feature<Point | LineString>[] {
  const point: Point = { type: 'Point', coordinates: [lon, lat] }
  if (!line) return [{ type: 'Feature', properties: { name, kind, minzoom }, geometry: point }]
  const along: Feature<LineString> = {
    type: 'Feature',
    properties: { name, kind, minzoom: Math.max(minzoom, LINE_NAMES_FROM_ZOOM) },
    geometry: { type: 'LineString', coordinates: line },
  }
  if (minzoom >= LINE_NAMES_FROM_ZOOM) return [along]
  return [along, { type: 'Feature', properties: { name, kind, minzoom, until: LINE_NAMES_FROM_ZOOM }, geometry: point }]
}

const SEA_NAMES: FeatureCollection<Point | LineString> = {
  type: 'FeatureCollection',
  features: (seaNames.names as SeaName[]).flatMap(seaNameFeatures),
}

const seaNameSize: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  5,
  ['match', ['get', 'kind'], 'sea', 13, 11.5],
  10,
  ['match', ['get', 'kind'], 'sea', 16, 13.5],
  14,
  ['match', ['get', 'kind'], 'sea', 18, 15],
]
const seaNamePaint = {
  'text-color': MAP_COLORS.waterLabel,
  'text-opacity': ['match', ['get', 'kind'], 'sea', 0.75, 1] as ExpressionSpecification,
  'text-halo-color': 'rgba(255,255,255,0.55)',
  'text-halo-width': 1.2,
}

const SEA_LINE_NAME_LAYER: LayerSpecification = {
  id: 'label_sea_line',
  type: 'symbol',
  source: 'sea-names',
  filter: ['all', ['==', ['geometry-type'], 'LineString'], ['>=', ['zoom'], ['get', 'minzoom']]],
  layout: {
    'symbol-placement': 'line-center',
    'text-field': ['get', 'name'],
    'text-font': ['Noto Sans Italic'],
    'text-size': seaNameSize,
    'text-letter-spacing': 0.12,
    'text-max-angle': 35,
    'text-keep-upright': true,
    'text-padding': 2,
    'symbol-sort-key': ['get', 'minzoom'],
  },
  paint: seaNamePaint,
}

const SEA_NAME_LAYER: LayerSpecification = {
  id: 'label_sea',
  type: 'symbol',
  source: 'sea-names',
  filter: [
    'all',
    ['==', ['geometry-type'], 'Point'],
    ['>=', ['zoom'], ['get', 'minzoom']],
    ['<', ['zoom'], ['coalesce', ['get', 'until'], 99]],
  ],
  layout: {
    'text-field': ['case', ['==', ['get', 'kind'], 'sea'], ['upcase', ['get', 'name']], ['get', 'name']],
    'text-font': ['Noto Sans Italic'],
    'text-size': seaNameSize,
    'text-letter-spacing': ['match', ['get', 'kind'], 'sea', 0.35, 0.12],
    'text-max-width': 8,
    'text-padding': 2,
    // when the name collides (e.g. with a town), try it beside the point; big areas get placed first
    'text-variable-anchor': ['center', 'top', 'bottom'], // not left/right: that would push the name onto land
    'text-radial-offset': 0.6,
    'symbol-sort-key': ['get', 'minzoom'],
  },
  paint: seaNamePaint,
}

/** Restyles the basemap for the sea: colours, coastline, Norwegian names, island names. Call on every style load. */
export function simplifyBasemap(map: MLMap) {
  for (const layer of map.getStyle().layers) {
    if (!KEEP.has(layer.id)) {
      map.setLayoutProperty(layer.id, 'visibility', 'none')
      continue
    }
    if (layer.id === 'background') map.setPaintProperty(layer.id, 'background-color', MAP_COLORS.land)
    else if (layer.id === 'water') map.setPaintProperty(layer.id, 'fill-color', MAP_COLORS.water)
    else if (layer.id === 'waterway') map.setPaintProperty(layer.id, 'line-color', MAP_COLORS.water)
    else if (layer.type === 'symbol') {
      map.setLayoutProperty(layer.id, 'text-field', NAME)
      map.setPaintProperty(layer.id, 'text-halo-color', MAP_COLORS.labelHalo)
      map.setPaintProperty(layer.id, 'text-halo-blur', 0.3)
      const style = LABEL_STYLES[layer.id]
      if (!style) continue
      map.setLayoutProperty(layer.id, 'text-size', style.size)
      if (style.spacing !== undefined) map.setLayoutProperty(layer.id, 'text-letter-spacing', style.spacing)
      map.setPaintProperty(layer.id, 'text-color', style.color)
      map.setPaintProperty(layer.id, 'text-halo-width', style.halo)
    }
  }
  const firstLabel = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
  // land colours go under the sea (so the water polygons cut them at the coast), the coastline on top of it
  for (const layer of LAND_LAYERS)
    if (map.getSource((layer as { source: string }).source) && !map.getLayer(layer.id)) map.addLayer(layer, 'water')
  if (!map.getSource('openmaptiles')) return
  if (!map.getLayer(COASTLINE_LAYER.id)) map.addLayer(COASTLINE_LAYER, firstLabel)
  // sea, island and coastal names under the town names, so towns win when labels collide
  const firstTown = map.getLayer('label_village') ? 'label_village' : undefined
  if (!map.getSource('sea-names')) map.addSource('sea-names', { type: 'geojson', data: SEA_NAMES })
  for (const layer of [SEA_LINE_NAME_LAYER, SEA_NAME_LAYER, ...NAME_LAYERS]) if (!map.getLayer(layer.id)) map.addLayer(layer, firstTown)
  // towns from the region overview on (the stock style starts at zoom 6, just above a phone's view of a region)
  if (map.getLayer('label_town')) map.setLayerZoomRange('label_town', 5, 24)
}
