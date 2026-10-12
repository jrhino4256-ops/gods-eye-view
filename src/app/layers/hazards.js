import * as Cesium from 'cesium';
import {
  createAuroraLayer,
  createEonetLayer,
  createGdacsLayer,
  createNwsAlertsLayer,
} from '../../layers/hazards/index.js';
import * as picking from '../../data/pickRegistry.js';
import * as overlays from '../../overlays/worldOverlay.js';
import { isPointerFree } from '../../data/inputOwnership.js';

/** Overlay, picking and pointer seams shared by the keyless hazard feeds. */
function hazardHost() {
  return {
    overlayHost: {
      setEntries: overlays.setOverlayEntries,
      setVisible: overlays.setOverlaySourceVisible,
      clearSource: overlays.clearOverlaySource,
      hitTest: overlays.hitTestWorldOverlay,
    },
    openExternal: (url) => window.open(url, '_blank', 'noopener,noreferrer'),
    screenSpaceEventHandlerFactory: (viewer) =>
      new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas),
    picking,
    pointer: { isPointerFree },
  };
}

/** Wire the GDACS, EONET, NWS alert and aurora feeds into the catalog. */
export function createApplicationHazards(sources) {
  return [
    createGdacsLayer({ ...hazardHost(), source: sources['gdacs-alerts'] }),
    createEonetLayer({ ...hazardHost(), source: sources['eonet-events'] }),
    createNwsAlertsLayer({
      ...hazardHost(),
      source: sources['weather-alerts'],
    }),
    createAuroraLayer({ ...hazardHost(), source: sources.aurora }),
  ];
}
