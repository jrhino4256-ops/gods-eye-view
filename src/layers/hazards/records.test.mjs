import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAge, safeLink } from './common.js';
import { normalizeGdacsSnapshot, GDACS_FEED } from './gdacs.js';
import { normalizeEonetSnapshot } from './eonet.js';
import { normalizeNwsAlertsSnapshot } from './nwsAlerts.js';
import { normalizeAuroraSnapshot, auroraColor } from './aurora.js';
import {
  createAuroraSource,
  createEonetSource,
  createGdacsSource,
  createNwsAlertsSource,
} from './source.js';

const gdacsFeature = (props, coordinates = [102.5, -5.4]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties: {
    eventtype: 'EQ',
    eventid: 1,
    name: 'Earthquake in Indonesia',
    alertlevel: 'Green',
    country: 'Indonesia',
    fromdate: '2026-10-10T21:38:09',
    severitydata: { severitytext: 'Magnitude 4.5M' },
    url: { report: 'https://www.gdacs.org/report.aspx?eventid=1' },
    ...props,
  },
});

test('GDACS rows are validated, deduplicated and ordered by alert level', () => {
  const rows = normalizeGdacsSnapshot({
    features: [
      gdacsFeature({}),
      gdacsFeature({ eventid: 2, eventtype: 'TC', alertlevel: 'Red' }),
      gdacsFeature({ eventid: 1 }),
      gdacsFeature({ eventid: 3, eventtype: 'XX' }),
      gdacsFeature({ eventid: 4 }, [200, 0]),
      gdacsFeature({ eventid: 5, url: { report: 'https://evil.example/' } }),
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.stableId, row.alertLevel]),
    [
      ['TC-2', 'Red'],
      ['EQ-1', 'Green'],
      ['EQ-5', 'Green'],
    ],
  );
  assert.equal(rows[1].fromMs, Date.parse('2026-10-10T21:38:09Z'));
  assert.equal(rows[1].link, 'https://www.gdacs.org/report.aspx?eventid=1');
  assert.equal(rows[2].link, null, 'only gdacs.org links are kept');
  assert.equal(normalizeGdacsSnapshot({}), null);
  const card = GDACS_FEED.card(rows[0], rows[0].fromMs + 2 * 3600000);
  assert.equal(card.title, 'RED · Earthquake in Indonesia');
  assert.ok(card.details.includes('began 2h ago'));
});

test('EONET keeps the latest position of categories no other layer covers', () => {
  const rows = normalizeEonetSnapshot({
    events: [
      {
        id: 'EONET_1',
        title: 'Iceberg B22F',
        categories: [{ id: 'seaLakeIce' }],
        sources: [{ url: 'https://usicecenter.gov/x' }],
        geometry: [
          { type: 'Point', date: '2026-10-01T00:00:00Z', coordinates: [1, 2] },
          {
            type: 'Point',
            date: '2026-10-02T00:00:00Z',
            coordinates: [3, 4],
            magnitudeValue: 98,
            magnitudeUnit: 'NM^2',
          },
        ],
      },
      {
        id: 'EONET_2',
        title: 'Wildfire',
        categories: [{ id: 'wildfires' }],
        geometry: [{ type: 'Point', coordinates: [5, 6] }],
      },
      {
        id: 'EONET_3',
        title: 'Etna',
        categories: [{ id: 'volcanoes' }],
        sources: [{ url: 'https://volcano.si.edu/volcano.cfm?vn=211060' }],
        geometry: [
          {
            type: 'Polygon',
            coordinates: [
              [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2],
              ],
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    rows.map(({ stableId, lon, lat }) => [stableId, lon, lat]),
    [
      ['EONET_1', 3, 4],
      ['EONET_3', 1, 1],
    ],
  );
  assert.equal(rows[0].magnitude, '98 NM^2');
  assert.equal(rows[0].link, null, 'unlisted hosts are not opened');
  assert.equal(rows[1].link, 'https://volcano.si.edu/volcano.cfm?vn=211060');
  assert.equal(normalizeEonetSnapshot({ events: 'x' }), null);
});

test('NWS alerts keep polygon warnings only, most severe first', () => {
  const ring = [
    [-80, 33],
    [-81, 33],
    [-81, 34],
    [-80, 33],
  ];
  const feature = (
    id,
    severity,
    geometry = { type: 'Polygon', coordinates: [ring] },
  ) => ({
    geometry,
    properties: {
      id,
      severity,
      event: 'Flash Flood Warning',
      areaDesc: 'Aiken, SC',
      expires: '2026-10-11T02:00:00Z',
    },
  });
  const rows = normalizeNwsAlertsSnapshot({
    features: [
      feature('a', 'Moderate'),
      feature('b', 'Extreme'),
      feature('c', 'Severe', null),
      feature('d', 'Minor'),
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.stableId, row.severity]),
    [
      ['b', 'Extreme'],
      ['a', 'Moderate'],
    ],
  );
  assert.equal(rows[0].ring.length, 4);
  assert.equal(rows[0].endsMs, Date.parse('2026-10-11T02:00:00Z'));
  assert.ok(Math.abs(rows[0].anchor.lon - -80.667) < 0.01);
  assert.equal(normalizeNwsAlertsSnapshot(null), null);
});

test('aurora cells pool the 1° grid, wrap longitude and drop faint cells', () => {
  const rows = normalizeAuroraSnapshot({
    'Forecast Time': '2026-10-11T01:06:00Z',
    coordinates: [
      [0, 65, 20],
      [1, 65, 40],
      [359, 65, 15],
      [10, 0, 5],
    ],
  });
  assert.deepEqual(
    rows
      .map(({ lon, lat, probability }) => [lon, lat, probability])
      .sort((a, b) => a[0] - b[0]),
    [
      [-1, 65, 15],
      [1, 65, 40],
    ],
  );
  assert.equal(rows[0].hemisphere, 'north');
  assert.equal(normalizeAuroraSnapshot({ coordinates: [[0, 'x', 1]] }), null);
  assert.equal(auroraColor(80), '#ff4081');
});

test('safeLink and formatAge reject what they cannot show safely', () => {
  assert.equal(
    safeLink('http://www.gdacs.org/a', ['gdacs.org']),
    'https://www.gdacs.org/a',
  );
  assert.equal(safeLink('https://gdacs.org.evil.com/', ['gdacs.org']), null);
  assert.equal(safeLink('javascript:alert(1)', ['gdacs.org']), null);
  assert.equal(safeLink(undefined, ['gdacs.org']), null);
  assert.equal(formatAge(-1), null);
  assert.equal(formatAge(30 * 60000), '30m');
  assert.equal(formatAge(3 * 86400000), '3d');
});

test('every source rejects HTTP errors and malformed bodies, and honors abort', async () => {
  for (const factory of [
    createGdacsSource,
    createEonetSource,
    createNwsAlertsSource,
    createAuroraSource,
  ]) {
    const failing = factory({
      fetchImpl: async () => ({ ok: false, status: 503 }),
    });
    await assert.rejects(failing.getSnapshot(), /HTTP 503/);
    const malformed = factory({
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    });
    await assert.rejects(malformed.getSnapshot(), /Malformed/);
    const abort = new AbortController();
    const aborting = factory({
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          abort.abort();
          return {};
        },
      }),
    });
    await assert.rejects(aborting.getSnapshot({ signal: abort.signal }), {
      name: 'AbortError',
    });
  }
});
