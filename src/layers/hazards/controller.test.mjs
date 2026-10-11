import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAuroraLayer,
  createEonetLayer,
  createGdacsLayer,
  createNwsAlertsLayer,
} from './index.js';

const GDACS_ROW = {
  stableId: 'EQ-1',
  type: 'EQ',
  typeLabel: 'Earthquake',
  alertLevel: 'Orange',
  name: 'Earthquake in Chile',
  country: 'Chile',
  severity: 'Magnitude 6.1M',
  fromMs: 1000,
  toMs: 1000,
  link: 'https://www.gdacs.org/report.aspx?eventid=1',
  lon: -70,
  lat: -30,
};

function harness(createLayer, source) {
  const dataSources = [];
  const overlay = { entries: [], visible: new Map(), cleared: 0 };
  const viewer = {
    dataSources: {
      add: (value) => dataSources.push(value),
      remove: (value) => dataSources.splice(dataSources.indexOf(value), 1),
    },
  };
  const layer = createLayer({
    source,
    overlayHost: {
      setEntries: (...args) => overlay.entries.push(args),
      setVisible: (id, visible) => overlay.visible.set(id, visible),
      clearSource: () => overlay.cleared++,
    },
  });
  layer.init(viewer);
  return { layer, viewer, dataSources, overlay };
}

test('a refresh replaces entities and exposes analyst records only while enabled', async () => {
  const h = harness(createGdacsLayer, { getSnapshot: async () => [GDACS_ROW] });
  assert.equal(await h.layer.update(), false, 'disabled layers do not fetch');
  h.layer.enable();
  assert.equal(h.overlay.visible.get('gdacs-alerts'), true);
  assert.equal(await h.layer.update(), true);
  const [dataSource] = h.dataSources;
  assert.equal(dataSource.show, true);
  assert.deepEqual(
    dataSource.entities.values.map((entity) => entity.id),
    ['gdacs-alerts:EQ-1'],
  );
  assert.equal(h.layer.getStats().count, 1);
  assert.deepEqual(h.layer.getAnalystRecords(), [
    {
      id: 'EQ-1',
      type: 'Earthquake',
      alertLevel: 'Orange',
      name: 'Earthquake in Chile',
      country: 'Chile',
      severity: 'Magnitude 6.1M',
      lat: -30,
      lon: -70,
      startMs: 1000,
    },
  ]);
  h.layer.disable();
  assert.equal(dataSource.show, false);
  assert.deepEqual(h.layer.getAnalystRecords(), []);
  h.layer.destroy();
  assert.equal(h.dataSources.length, 0);
});

test('a failed refresh keeps the last good snapshot and reports the error', async () => {
  let fail = false;
  const h = harness(createGdacsLayer, {
    getSnapshot: async () => {
      if (fail) throw new Error('GDACS HTTP 503');
      return [GDACS_ROW];
    },
  });
  h.layer.enable();
  await h.layer.update();
  fail = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await h.layer.update(), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(h.dataSources[0].entities.values.length, 1);
  assert.equal(h.layer.getStats().error, 'GDACS HTTP 503');
  h.layer.destroy();
});

test('a late snapshot cannot publish after disable or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve;
    let signal;
    const h = harness(createGdacsLayer, {
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    h.layer.enable();
    const pending = h.layer.update();
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    resolve([GDACS_ROW]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    if (action === 'disable') h.layer.destroy();
  }
});

test('every hazard feed builds entities from its own rows', async () => {
  const cases = [
    [
      createEonetLayer,
      {
        stableId: 'EONET_1',
        categoryId: 'volcanoes',
        categoryLabel: 'Volcano',
        title: 'Etna',
        magnitude: null,
        dateMs: 0,
        link: null,
        lon: 15,
        lat: 37.7,
      },
    ],
    [
      createNwsAlertsLayer,
      {
        stableId: 'urn:1',
        event: 'Tornado Warning',
        severity: 'Extreme',
        ring: [
          { lon: -97, lat: 35 },
          { lon: -96, lat: 35 },
          { lon: -96, lat: 36 },
          { lon: -97, lat: 35 },
        ],
        anchor: { lon: -96.7, lat: 35.3 },
      },
    ],
    [createAuroraLayer, { stableId: '1,65', lon: 1, lat: 65, probability: 40 }],
  ];
  for (const [createLayer, row] of cases) {
    const h = harness(createLayer, { getSnapshot: async () => [row] });
    h.layer.enable();
    assert.equal(await h.layer.update(), true, h.layer.id);
    const [entity] = h.dataSources[0].entities.values;
    assert.equal(entity.id, `${h.layer.id}:${row.stableId}`);
    assert.ok(entity.point || entity.polygon, h.layer.id);
    h.layer.destroy();
  }
});
