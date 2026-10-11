import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import {
  createAuroraSource,
  createEonetSource,
  createGdacsSource,
  createNwsAlertsSource,
} from '../layers/hazards/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'fire-perimeters': createWfigsPerimeterSource(),
    'gdacs-alerts': createGdacsSource(),
    'eonet-events': createEonetSource(),
    'weather-alerts': createNwsAlertsSource(),
    aurora: createAuroraSource(),
    cables: createBundledCableSource(),
  };
}
