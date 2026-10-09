// -----------------------------------------------------------------------------
// One signed-in session with Ring, through ring-client-api.
//
// What the library does for us, and what it costs:
//   - authentication with the refresh token, and its rotation
//     (`onRefreshTokenUpdated`, saved by the caller in /data);
//   - real-time doorbell presses and motions through Firebase Cloud Messaging
//     push notifications (the method of the Ring app itself, registered as a
//     "Gladys Assistant" device in Ring's Control Center);
//   - the camera status (battery, light, siren, offline) refreshed every
//     60 s with ONE request for the whole account (`ring_devices`), the pace
//     of the Home Assistant integration;
//   - the Ring Alarm devices over the location's WebSocket, pushed in real
//     time (no polling).
// Memory: importing the library and its dependencies costs about 70 MB of
// RSS (measured on Node 24), the whole container stays well under 256 MB.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { RING_DEVICE_TYPES, isSupportedSensor } from '../devices/alarm.js';

const logger = createLogger({ name: 'ring' });

export const CAMERA_STATUS_POLLING_SECONDS = 60;
// A Ring call that never answers (the library retries network errors
// forever) must not leave the integration "connecting" for ever.
const START_TIMEOUT_MS = 60_000;
const ALARM_DEVICES_TIMEOUT_MS = 30_000;

export class RingAuthError extends Error {}
export class RingUnreachableError extends Error {}

function withTimeout(promise, ms, error) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(error), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * ring-client-api reports a refused token with these messages (rest-client
 * `getAuth`): anything else is a network or server problem, worth a retry.
 */
export function isAuthError(err) {
  const message = err?.message ?? '';
  return /Refresh token is not valid|Failed to fetch oauth token|invalid_grant/i.test(message);
}

/** Lazy import: the tests never load the library. */
export async function defaultCreateRingApi(options) {
  const { RingApi } = await import('ring-client-api');
  return new RingApi(options);
}

export class RingSession {
  /**
   * @param {object} deps
   * @param {(options: object) => Promise<object>|object} [deps.createRingApi]
   */
  constructor({ createRingApi = defaultCreateRingApi } = {}) {
    this.createRingApi = createRingApi;
    this.api = null;
    this.subscriptions = [];
    /** @type {Array<{ id: string, name: string, cameras: object[], panel: object|null, sensors: object[] }>} */
    this.locations = [];
  }

  /**
   * Sign in and load the locations, cameras and alarm devices.
   * @param {{ refreshToken: string, systemId: string, onToken: (token: string) => void }} options
   */
  async start({ refreshToken, systemId, onToken }) {
    this.api = await this.createRingApi({
      refreshToken,
      systemId,
      controlCenterDisplayName: 'Gladys Assistant',
      cameraStatusPollingSeconds: CAMERA_STATUS_POLLING_SECONDS,
      // Battery cameras: a requested snapshot is reused for 10 minutes instead
      // of waking the camera every time (ring-client-api option).
      avoidSnapshotBatteryDrain: true,
    });
    this.subscriptions.push(
      this.api.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => onToken(newRefreshToken)),
    );

    let locations;
    try {
      locations = await withTimeout(
        this.api.getLocations(),
        START_TIMEOUT_MS,
        new RingUnreachableError('Ring did not answer within 60 s'),
      );
    } catch (err) {
      if (err instanceof RingUnreachableError) {
        throw err;
      }
      if (isAuthError(err)) {
        throw new RingAuthError(err.message);
      }
      throw new RingUnreachableError(err?.message ?? String(err));
    }

    this.locations = [];
    for (const location of locations) {
      const entry = {
        id: location.id,
        name: location.name,
        location,
        cameras: location.cameras ?? [],
        panel: null,
        sensors: [],
      };
      if (location.hasAlarmBaseStation) {
        try {
          const devices = await withTimeout(
            location.getDevices(),
            ALARM_DEVICES_TIMEOUT_MS,
            new Error('no answer from the alarm'),
          );
          entry.panel =
            devices.find((d) => d.data.deviceType === RING_DEVICE_TYPES.SECURITY_PANEL) ?? null;
          entry.sensors = devices.filter((d) => isSupportedSensor(d.data));
        } catch (err) {
          logger.warn(`Ring Alarm of "${location.name}" not loaded: ${err.message}`);
        }
      }
      this.locations.push(entry);
    }
    return this;
  }

  get cameras() {
    return this.locations.flatMap((location) => location.cameras);
  }

  findCamera(cameraId) {
    return this.cameras.find((camera) => String(camera.id) === String(cameraId)) ?? null;
  }

  findLocation(locationId) {
    return this.locations.find((location) => String(location.id) === String(locationId)) ?? null;
  }

  findSensor(zid) {
    for (const location of this.locations) {
      const sensor = location.sensors.find((s) => String(s.zid) === String(zid));
      if (sensor) {
        return sensor;
      }
    }
    return null;
  }

  /** Keep a subscription to drop on stop(). */
  track(subscription) {
    this.subscriptions.push(subscription);
  }

  stop() {
    for (const subscription of this.subscriptions) {
      try {
        subscription.unsubscribe();
      } catch {
        // Already closed.
      }
    }
    this.subscriptions = [];
    try {
      this.api?.disconnect();
    } catch (err) {
      logger.warn(`Ring disconnection failed: ${err.message}`);
    }
    this.api = null;
    this.locations = [];
  }
}
