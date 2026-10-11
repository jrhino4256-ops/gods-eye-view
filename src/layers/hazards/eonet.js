import {
  fetchJsonSnapshot,
  finiteLonLat,
  formatAge,
  safeLink,
  text,
} from './common.js';

export const EONET_LAYER_ID = 'eonet-events';
const API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=60';

/**
 * EONET categories shown here. Wildfires, severe storms and earthquakes are
 * left out: Active Fires, Cyclones and Earthquakes already cover them.
 */
export const EONET_CATEGORIES = Object.freeze({
  volcanoes: { label: 'Volcano', color: '#ff5722' },
  seaLakeIce: { label: 'Sea and lake ice', color: '#80deea' },
  dustHaze: { label: 'Dust and haze', color: '#d7b16a' },
  floods: { label: 'Flood', color: '#2196f3' },
  landslides: { label: 'Landslide', color: '#8d6e63' },
  snow: { label: 'Snow', color: '#eceff1' },
  drought: { label: 'Drought', color: '#ffb300' },
  tempExtremes: { label: 'Temperature extreme', color: '#e91e63' },
  waterColor: { label: 'Water color', color: '#26a69a' },
  manmade: { label: 'Manmade', color: '#b0bec5' },
});

const LINK_HOSTS = [
  'nasa.gov',
  'noaa.gov',
  'usgs.gov',
  'si.edu',
  'gdacs.org',
  'reliefweb.int',
  'unisys.com',
];

/** Mean of a ring's distinct vertices, for a Polygon geometry's anchor. */
function polygonAnchor(coordinates) {
  const ring = Array.isArray(coordinates?.[0]) ? coordinates[0] : null;
  if (!ring?.length) return null;
  const points = ring.map(finiteLonLat).filter(Boolean);
  if (!points.length) return null;
  const sum = points.reduce(
    (acc, point) => ({ lon: acc.lon + point.lon, lat: acc.lat + point.lat }),
    { lon: 0, lat: 0 },
  );
  return { lon: sum.lon / points.length, lat: sum.lat / points.length };
}

/**
 * Reduce open EONET events to one row each at their latest position. Returns
 * null for a malformed payload so the last good snapshot stays.
 */
export function normalizeEonetSnapshot(payload) {
  if (!Array.isArray(payload?.events)) return null;
  const rows = [];
  const ids = new Set();
  for (const event of payload.events) {
    const categoryId = event?.categories?.[0]?.id;
    const category = EONET_CATEGORIES[categoryId];
    const stableId = text(event?.id);
    if (!category || !stableId || ids.has(stableId)) continue;
    const geometries = Array.isArray(event.geometry) ? event.geometry : [];
    const latest = geometries.at(-1);
    const point =
      latest?.type === 'Point'
        ? finiteLonLat(latest.coordinates)
        : latest?.type === 'Polygon'
          ? polygonAnchor(latest.coordinates)
          : null;
    if (!point) continue;
    ids.add(stableId);
    const dateMs = Date.parse(latest.date ?? '');
    const magnitude = Number.isFinite(latest.magnitudeValue)
      ? `${latest.magnitudeValue} ${latest.magnitudeUnit ?? ''}`.trim()
      : null;
    rows.push({
      stableId,
      categoryId,
      categoryLabel: category.label,
      title: text(event.title),
      magnitude,
      dateMs: Number.isFinite(dateMs) ? dateMs : null,
      link: safeLink(event.sources?.[0]?.url, LINK_HOSTS),
      ...point,
    });
  }
  return rows;
}

/** Request open NASA EONET natural events. */
export function createEonetSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    getSnapshot: ({ signal } = {}) =>
      fetchJsonSnapshot({
        url: API_URL,
        label: 'EONET',
        normalize: normalizeEonetSnapshot,
        fetchImpl,
        signal,
      }),
  };
}

/**
 * Feed definition for createHazardLayer. `entity` receives the Cesium module
 * so this file stays importable without it.
 */
export const EONET_FEED = Object.freeze({
  id: EONET_LAYER_ID,
  name: 'Natural Events (NASA EONET)',
  icon: '🌍',
  sourceLabel: 'NASA EONET',
  updateInterval: 900000,
  entity(row, Cesium) {
    const color = Cesium.Color.fromCssColorString(
      EONET_CATEGORIES[row.categoryId].color,
    );
    return {
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
      point: {
        pixelSize: 11,
        color: color.withAlpha(0.9),
        outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    };
  },
  anchor: (row) => ({ lon: row.lon, lat: row.lat }),
  card(row, nowMs) {
    const age = formatAge(nowMs - row.dateMs);
    return {
      title: `${row.categoryLabel.toUpperCase()} · ${row.title || 'Open event'}`,
      details: [
        row.magnitude,
        row.dateMs != null && age ? `last observed ${age} ago` : null,
        'NASA EONET open event',
      ],
      accent: EONET_CATEGORIES[row.categoryId].color,
      link: row.link,
    };
  },
  analystRecord: (row) => ({
    id: row.stableId,
    category: row.categoryLabel,
    title: row.title,
    magnitude: row.magnitude,
    lat: row.lat,
    lon: row.lon,
    observedMs: row.dateMs,
  }),
});
