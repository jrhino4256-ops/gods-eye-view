import * as Cesium from 'cesium';

const CARD_HOST_OPTIONS = Object.freeze({
  cohortLimit: 1,
  collisionCapacity: 1,
  moving: false,
});

/**
 * Own one keyless hazard feed: a snapshot source, its Cesium entities and a
 * click-to-inspect card. Feed-specific parsing and styling live in the
 * `definition` (see gdacs.js, eonet.js, nwsAlerts.js, aurora.js), so every
 * hazard layer shares one lifecycle.
 *
 * definition: {
 *   id, name, icon, sourceLabel, updateInterval,
 *   entity(row, Cesium) → Cesium.Entity constructor options (without id),
 *   card(row, nowMs) → {title, details[], accent, link?} | null,
 *   anchor(row) → {lon, lat},
 *   analystRecord(row) → JSON-safe object,
 * }
 */
export function createHazardLayer({
  definition,
  source,
  overlayHost,
  picking,
  pointer,
  openExternal,
  screenSpaceEventHandlerFactory,
} = {}) {
  if (!definition?.id)
    throw new TypeError('Hazard layers require a definition');
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError(`${definition.id} requires a snapshot source`);
  if (!overlayHost)
    throw new TypeError(`${definition.id} requires an overlay host`);

  const overlaySourceId = definition.id;
  const pickPrefix = `${definition.id}:`;
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _enabled = false;
  let _rows = [];
  let _rowById = new Map();
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _clickHandler = null;
  let _selectedId = null;
  let _selectedLink = null;
  let _selectedCardId = null;

  const canSelect = () =>
    typeof screenSpaceEventHandlerFactory === 'function' &&
    typeof picking?.resolvePickId === 'function' &&
    typeof definition.card === 'function';

  function publishSelectedCard() {
    const row = _selectedId ? _rowById.get(_selectedId) : null;
    const model = row ? definition.card(row, Date.now()) : null;
    if (!row || !model) {
      _selectedId = null;
      _selectedLink = null;
      _selectedCardId = null;
      overlayHost.clearSource(overlaySourceId);
      return;
    }
    const { lon, lat } = definition.anchor(row);
    _selectedLink = model.link && openExternal ? model.link : null;
    _selectedCardId = `${definition.id}-card:${row.stableId}`;
    const card = {
      id: _selectedCardId,
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      selected: true,
      interactive: Boolean(_selectedLink),
      title: model.title,
      details: model.details.filter(Boolean),
      accent: model.accent,
      priority: Number.MAX_SAFE_INTEGER,
      gapPx: 15,
      verticalOnly: true,
      placement: 'above',
    };
    if (_selectedLink) {
      const link = _selectedLink;
      card.details.push('click card to open source ↗');
      card.accessibilityLabel = `Open ${model.title} at the source`;
      card.activate = () => {
        openExternal(link);
        return true;
      };
    }
    overlayHost.setEntries(overlaySourceId, [card], CARD_HOST_OPTIONS);
  }

  function pickedRowId(picked) {
    const pickId = picking.resolvePickId(picked);
    if (typeof pickId !== 'string' || !pickId.startsWith(pickPrefix))
      return null;
    const rowId = pickId.slice(pickPrefix.length);
    return _rowById.has(rowId) ? rowId : null;
  }

  function installClickHandler() {
    if (!canSelect() || _clickHandler || !_viewer) return;
    // Not registered in the pick-ownership registry, like fire perimeters:
    // large ground shapes must not make sibling layers' cards inert.
    _clickHandler = screenSpaceEventHandlerFactory(_viewer);
    _clickHandler.setInputAction((click) => {
      if (pointer && !pointer.isPointerFree()) return;
      const cardHit = overlayHost.hitTest?.(
        click.position?.x,
        click.position?.y,
        { sourceId: overlaySourceId },
      );
      if (cardHit && cardHit.entryId === _selectedCardId) {
        if (_selectedLink) openExternal(_selectedLink);
        return;
      }
      const picked = _viewer.scene.pick(click.position);
      const rowId = picked ? pickedRowId(picked) : null;
      if (rowId) {
        _selectedId = rowId;
        publishSelectedCard();
        return;
      }
      if (picked) {
        const pickId = picking.resolvePickId(picked);
        if (pickId && picking.isOwnedByOtherLayer?.(layer.id, pickId)) return;
      }
      if (_selectedId) {
        _selectedId = null;
        publishSelectedCard();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function removeClickHandler() {
    _clickHandler?.destroy();
    _clickHandler = null;
  }

  function clearSelection() {
    _selectedId = null;
    _selectedLink = null;
    _selectedCardId = null;
    overlayHost.clearSource(overlaySourceId);
  }

  const layer = {
    id: definition.id,
    name: definition.name,
    icon: definition.icon,
    source: definition.sourceLabel,
    updateInterval: definition.updateInterval,

    init(viewer) {
      if (_viewer) throw new Error(`${definition.id} is already initialized`);
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource(definition.id);
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _rows = [];
      _rowById = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      overlayHost.setVisible(overlaySourceId, false);
    },

    enable() {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(overlaySourceId, true);
      installClickHandler();
    },

    disable() {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
      removeClickHandler();
      clearSelection();
      overlayHost.setVisible(overlaySourceId, false);
    },

    async update() {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        const entities = rows.map(
          (row) =>
            new Cesium.Entity({
              id: `${pickPrefix}${row.stableId}`,
              ...definition.entity(row, Cesium),
            }),
        );
        _dataSource.entities.suspendEvents();
        _dataSource.entities.removeAll();
        for (const entity of entities) _dataSource.entities.add(entity);
        _dataSource.entities.resumeEvents();
        _rows = rows;
        _rowById = new Map(rows.map((row) => [String(row.stableId), row]));
        if (_selectedId) publishSelectedCard();
        _count = rows.length;
        _lastUpdate = Date.now();
        _lastError = null;
        return true;
      } catch (error) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn(`[Data:${definition.name}] Fetch error:`, error);
        _lastError = error?.message || `${definition.name} unavailable`;
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      removeClickHandler();
      clearSelection();
      overlayHost.setVisible(overlaySourceId, false);
      if (_dataSource && viewer) viewer.dataSources.remove(_dataSource, true);
      _dataSource = null;
      _viewer = null;
      _rows = [];
      _rowById = new Map();
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    /** JSON-safe records for the analyst query engine; [] while disabled. */
    getAnalystRecords(maxCount = 2000) {
      if (!_enabled) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      return _rows.slice(0, limit).map((row) => definition.analystRecord(row));
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
