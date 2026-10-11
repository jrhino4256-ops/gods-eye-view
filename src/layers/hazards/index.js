import { createHazardLayer } from './controller.js';
import { GDACS_FEED } from './gdacs.js';
import { EONET_FEED } from './eonet.js';
import { NWS_ALERTS_FEED } from './nwsAlerts.js';
import { AURORA_FEED } from './aurora.js';

export { createHazardLayer } from './controller.js';
export * from './gdacs.js';
export * from './eonet.js';
export * from './nwsAlerts.js';
export * from './aurora.js';

/** GDACS global disaster alerts (earthquakes, cyclones, floods, …). */
export const createGdacsLayer = (options) =>
  createHazardLayer({ definition: GDACS_FEED, ...options });

/** NASA EONET open natural events not covered by other layers. */
export const createEonetLayer = (options) =>
  createHazardLayer({ definition: EONET_FEED, ...options });

/** Active US National Weather Service warning polygons. */
export const createNwsAlertsLayer = (options) =>
  createHazardLayer({ definition: NWS_ALERTS_FEED, ...options });

/** NOAA SWPC aurora nowcast oval. */
export const createAuroraLayer = (options) =>
  createHazardLayer({ definition: AURORA_FEED, ...options });
