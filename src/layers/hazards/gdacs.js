import {
  fetchJsonSnapshot,
  finiteLonLat,
  formatAge,
  safeLink,
  text,
} from './common.js';

export const GDACS_LAYER_ID = 'gdacs-alerts';
const API_URL =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Green;Orange;Red';

export const GDACS_EVENT_TYPES = Object.freeze({
  EQ: 'Earthquake',
  TC: 'Tropical cyclone',
  FL: 'Flood',
  VO: 'Volcano',
  DR: 'Drought',
  WF: 'Wildfire',
});

const ALERT_COLORS = Object.freeze({
  Red: '#ff3b30',
  Orange: '#ff9500',
  Green: '#34c759',
});
const ALERT_RANK = Object.freeze({ Green: 1, Orange: 2, Red: 3 });

/**
 * Validate a GDACS event list and reduce it to plain rows, highest alert
 * first. Returns null for a malformed payload so the last good snapshot stays.
 */
export function normalizeGdacsSnapshot(payload) {
  if (!Array.isArray(payload?.features)) return null;
  const rows = [];
  const ids = new Set();
  for (const feature of payload.features) {
    const p = feature?.properties;
    const point = finiteLonLat(feature?.geometry?.coordinates);
    if (!p || !point || feature.geometry.type !== 'Point') continue;
    const type = String(p.eventtype || '');
    if (!GDACS_EVENT_TYPES[type]) continue;
    const stableId = `${type}-${p.eventid}`;
    if (p.eventid == null || ids.has(stableId)) continue;
    ids.add(stableId);
    const alertLevel = ALERT_RANK[p.alertlevel] ? p.alertlevel : 'Green';
    const fromMs = Date.parse(p.fromdate ? `${p.fromdate}Z` : '');
    const toMs = Date.parse(p.todate ? `${p.todate}Z` : '');
    rows.push({
      stableId,
      type,
      typeLabel: GDACS_EVENT_TYPES[type],
      alertLevel,
      name: text(p.name) || text(p.description),
      country: text(p.country),
      severity: text(p.severitydata?.severitytext),
      fromMs: Number.isFinite(fromMs) ? fromMs : null,
      toMs: Number.isFinite(toMs) ? toMs : null,
      link: safeLink(p.url?.report, ['gdacs.org']),
      ...point,
    });
  }
  rows.sort(
    (a, b) =>
      ALERT_RANK[b.alertLevel] - ALERT_RANK[a.alertLevel] ||
      (b.fromMs ?? 0) - (a.fromMs ?? 0),
  );
  return rows;
}

/** Request the current GDACS event list. */
export function createGdacsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    getSnapshot: ({ signal } = {}) =>
      fetchJsonSnapshot({
        url: API_URL,
        label: 'GDACS',
        normalize: normalizeGdacsSnapshot,
        fetchImpl,
        signal,
      }),
  };
}

/**
 * Feed definition for createHazardLayer. `entity` receives the Cesium module
 * so this file stays importable without it.
 */
export const GDACS_FEED = Object.freeze({
  id: GDACS_LAYER_ID,
  name: 'Disaster Alerts (GDACS)',
  icon: '🚨',
  sourceLabel: 'GDACS',
  updateInterval: 600000,
  entity(row, Cesium) {
    const color = Cesium.Color.fromCssColorString(ALERT_COLORS[row.alertLevel]);
    const size = { Green: 9, Orange: 13, Red: 17 }[row.alertLevel];
    return {
      position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
      point: {
        pixelSize: size,
        color: color.withAlpha(0.85),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
        outlineWidth: 1.5,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    };
  },
  anchor: (row) => ({ lon: row.lon, lat: row.lat }),
  card(row, nowMs) {
    const age = formatAge(nowMs - row.fromMs);
    return {
      title: `${row.alertLevel.toUpperCase()} · ${row.name || row.typeLabel}`,
      details: [
        [row.typeLabel, row.country].filter(Boolean).join(' · '),
        row.severity,
        row.fromMs != null && age ? `began ${age} ago` : null,
        'GDACS alert level',
      ],
      accent: ALERT_COLORS[row.alertLevel],
      link: row.link,
    };
  },
  analystRecord: (row) => ({
    id: row.stableId,
    type: row.typeLabel,
    alertLevel: row.alertLevel,
    name: row.name,
    country: row.country,
    severity: row.severity,
    lat: row.lat,
    lon: row.lon,
    startMs: row.fromMs,
  }),
});
