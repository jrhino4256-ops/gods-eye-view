import { fetchJsonSnapshot, text } from './common.js';

export const AURORA_LAYER_ID = 'aurora';
const API_URL =
  'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

/** Grid cells under this probability (percent) are not drawn. */
export const AURORA_MIN_PROBABILITY = 10;
/** The 1° OVATION grid is pooled into cells this many degrees wide. */
export const AURORA_CELL_DEG = 2;

/**
 * Pool the OVATION 1° aurora grid into AURORA_CELL_DEG cells, keeping each
 * cell's highest probability, and drop cells below AURORA_MIN_PROBABILITY.
 * Longitudes arrive as 0–359 and are returned as -180–180. Null for a
 * malformed payload.
 */
export function normalizeAuroraSnapshot(payload) {
  if (!Array.isArray(payload?.coordinates)) return null;
  const forecastMs = Date.parse(payload['Forecast Time'] ?? '');
  const observedAt = text(payload['Observation Time']);
  const cells = new Map();
  for (const entry of payload.coordinates) {
    if (!Array.isArray(entry) || entry.length < 3) return null;
    const [rawLon, lat, probability] = entry;
    if (
      !Number.isFinite(rawLon) ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(probability)
    )
      return null;
    if (probability < AURORA_MIN_PROBABILITY) continue;
    const lon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
    const cellLon =
      Math.floor(lon / AURORA_CELL_DEG) * AURORA_CELL_DEG + AURORA_CELL_DEG / 2;
    const cellLat = Math.max(
      -89,
      Math.min(
        89,
        Math.floor(lat / AURORA_CELL_DEG) * AURORA_CELL_DEG +
          AURORA_CELL_DEG / 2,
      ),
    );
    const key = `${cellLon},${cellLat}`;
    const existing = cells.get(key);
    if (!existing || probability > existing.probability)
      cells.set(key, { lon: cellLon, lat: cellLat, probability });
  }
  return [...cells.entries()].map(([key, cell]) => ({
    stableId: key,
    ...cell,
    hemisphere: cell.lat >= 0 ? 'north' : 'south',
    forecastMs: Number.isFinite(forecastMs) ? forecastMs : null,
    observedAt,
  }));
}

/** Request the latest NOAA SWPC OVATION aurora nowcast. */
export function createAuroraSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    getSnapshot: ({ signal } = {}) =>
      fetchJsonSnapshot({
        url: API_URL,
        label: 'SWPC aurora',
        normalize: normalizeAuroraSnapshot,
        fetchImpl,
        signal,
      }),
  };
}

/** Green below 50 %, shading to red for the strongest aurora. */
export function auroraColor(probability) {
  if (probability >= 70) return '#ff4081';
  if (probability >= 50) return '#e040fb';
  if (probability >= 30) return '#69f0ae';
  return '#00e676';
}

/**
 * Feed definition for createHazardLayer. `entity` receives the Cesium module
 * so this file stays importable without it.
 */
export const AURORA_FEED = Object.freeze({
  id: AURORA_LAYER_ID,
  name: 'Aurora Forecast',
  icon: '🌌',
  sourceLabel: 'NOAA SWPC',
  updateInterval: 600000,
  entity(row, Cesium) {
    const alpha = Math.min(0.85, 0.2 + row.probability / 100);
    return {
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat, 100000),
      point: {
        pixelSize: 7,
        color: Cesium.Color.fromCssColorString(
          auroraColor(row.probability),
        ).withAlpha(alpha),
        scaleByDistance: new Cesium.NearFarScalar(1.5e6, 2.0, 2.0e7, 0.8),
      },
    };
  },
  anchor: (row) => ({ lon: row.lon, lat: row.lat }),
  card(row) {
    return {
      title: `AURORA · ${Math.round(row.probability)}% chance`,
      details: [
        `${row.hemisphere === 'north' ? 'Northern' : 'Southern'} oval`,
        row.forecastMs != null
          ? `forecast for ${new Date(row.forecastMs).toISOString().slice(11, 16)} UTC`
          : null,
        'NOAA SWPC OVATION nowcast',
      ],
      accent: auroraColor(row.probability),
      link: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
    };
  },
  analystRecord: (row) => ({
    id: row.stableId,
    probability: row.probability,
    hemisphere: row.hemisphere,
    lat: row.lat,
    lon: row.lon,
    forecastMs: row.forecastMs,
  }),
});
