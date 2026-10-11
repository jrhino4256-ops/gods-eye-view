import { fetchJsonSnapshot, finiteLonLat, formatAge, text } from './common.js';

export const NWS_ALERTS_LAYER_ID = 'weather-alerts';
const API_URL =
  'https://api.weather.gov/alerts/active?status=actual&message_type=alert,update&severity=Extreme,Severe,Moderate';

export const NWS_SEVERITY_COLORS = Object.freeze({
  Extreme: '#d500f9',
  Severe: '#ff1744',
  Moderate: '#ff9100',
});
const SEVERITY_RANK = Object.freeze({ Moderate: 1, Severe: 2, Extreme: 3 });

/** Outer ring of a GeoJSON Polygon as validated {lon, lat} vertices. */
function outerRing(geometry) {
  if (geometry?.type !== 'Polygon') return null;
  const ring = geometry.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const points = ring.map(finiteLonLat);
  return points.every(Boolean) ? points : null;
}

/**
 * Keep active NWS alerts that carry their own polygon (warnings drawn by the
 * forecaster); zone-only alerts have no geometry in this feed and are left
 * out. Highest severity first. Null for a malformed payload.
 */
export function normalizeNwsAlertsSnapshot(payload) {
  if (!Array.isArray(payload?.features)) return null;
  const rows = [];
  const ids = new Set();
  for (const feature of payload.features) {
    const p = feature?.properties;
    const ring = outerRing(feature?.geometry);
    const stableId = text(p?.id);
    if (!ring || !stableId || ids.has(stableId)) continue;
    if (!SEVERITY_RANK[p.severity]) continue;
    ids.add(stableId);
    const onsetMs = Date.parse(p.onset || p.effective || '');
    const endsMs = Date.parse(p.ends || p.expires || '');
    const anchor = ring.slice(0, -1).reduce(
      (acc, point, _, all) => ({
        lon: acc.lon + point.lon / all.length,
        lat: acc.lat + point.lat / all.length,
      }),
      { lon: 0, lat: 0 },
    );
    rows.push({
      stableId,
      event: text(p.event) || 'Weather alert',
      severity: p.severity,
      urgency: text(p.urgency),
      certainty: text(p.certainty),
      area: text(p.areaDesc),
      sender: text(p.senderName),
      headline: text(p.headline),
      onsetMs: Number.isFinite(onsetMs) ? onsetMs : null,
      endsMs: Number.isFinite(endsMs) ? endsMs : null,
      ring,
      anchor,
    });
  }
  rows.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  return rows;
}

/** Request active US National Weather Service alerts. */
export function createNwsAlertsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    getSnapshot: ({ signal } = {}) =>
      fetchJsonSnapshot({
        url: API_URL,
        label: 'NWS alerts',
        normalize: normalizeNwsAlertsSnapshot,
        fetchImpl,
        signal,
        headers: { Accept: 'application/geo+json' },
      }),
  };
}

/**
 * Feed definition for createHazardLayer. `entity` receives the Cesium module
 * so this file stays importable without it.
 */
export const NWS_ALERTS_FEED = Object.freeze({
  id: NWS_ALERTS_LAYER_ID,
  name: 'Severe Weather Alerts (US)',
  icon: '⚠️',
  sourceLabel: 'NOAA NWS',
  updateInterval: 120000,
  entity(row, Cesium) {
    const color = Cesium.Color.fromCssColorString(
      NWS_SEVERITY_COLORS[row.severity],
    );
    return {
      polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArray(
          row.ring.flatMap((point) => [point.lon, point.lat]),
        ),
        material: color.withAlpha(0.25),
        outline: false,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(
          row.ring.flatMap((point) => [point.lon, point.lat]),
        ),
        width: 2,
        material: color.withAlpha(0.9),
        clampToGround: true,
      },
    };
  },
  anchor: (row) => row.anchor,
  card(row, nowMs) {
    const until =
      row.endsMs != null && row.endsMs > nowMs
        ? `ends in ${formatAge(row.endsMs - nowMs)}`
        : null;
    return {
      title: `${row.severity.toUpperCase()} · ${row.event}`,
      details: [
        row.area,
        [row.urgency, row.certainty].filter(Boolean).join(' · ') || null,
        until,
        row.sender,
      ],
      accent: NWS_SEVERITY_COLORS[row.severity],
      link: null,
    };
  },
  analystRecord: (row) => ({
    id: row.stableId,
    event: row.event,
    severity: row.severity,
    urgency: row.urgency,
    area: row.area,
    lat: row.anchor.lat,
    lon: row.anchor.lon,
    onsetMs: row.onsetMs,
    endsMs: row.endsMs,
  }),
});
