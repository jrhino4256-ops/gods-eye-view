/** Shared helpers for the keyless hazard feeds. Pure — no Cesium types. */

/** Trimmed non-empty string, or null. */
export function text(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

/** {lon, lat} from a GeoJSON position, or null when out of range. */
export function finiteLonLat(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lon, lat] = coordinates;
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return null;
  return { lon, lat };
}

/** Compact age such as 5m, 3h or 2d; null for a negative or unknown span. */
export function formatAge(deltaMs) {
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  const hours = Math.floor(deltaMs / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(deltaMs / 60000))}m`;
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Fetch one JSON snapshot and validate it before it may replace what is shown.
 * `normalize` returns null for a malformed payload.
 */
export async function fetchJsonSnapshot({
  url,
  label,
  normalize,
  fetchImpl,
  signal,
  headers,
}) {
  signal?.throwIfAborted();
  const response = await fetchImpl(url, {
    signal,
    ...(headers ? { headers } : {}),
  });
  if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
  const payload = await response.json();
  signal?.throwIfAborted();
  const rows = normalize(payload);
  if (!rows) throw new Error(`Malformed ${label} response`);
  return rows;
}

/**
 * An https link on one of `hosts` (or their subdomains), else null. Feed data
 * is external, so only links to the publishing agency are ever opened.
 */
export function safeLink(value, hosts) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  if (
    !hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  )
    return null;
  url.protocol = 'https:';
  return url.href;
}
