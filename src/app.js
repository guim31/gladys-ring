// -----------------------------------------------------------------------------
// The integration: Ring on one side, Gladys on the other.
//
// `createApp` takes its collaborators as parameters (the SDK client, the Ring
// library factories, the data folder, the clock), so the tests drive it with a
// fake Gladys and fake Ring objects built from recorded API data, without any
// network. index.js only wires the real ones.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { TEXTS } from './i18n.js';
import { createTokenStore } from './auth/tokenStore.js';
import { SIGN_IN_MESSAGES, createSignIn } from './auth/signIn.js';
import { RingAuthError, RingSession } from './ring/session.js';
import { createStatePublisher } from './states.js';
import { createEventLog, parseNotification } from './events.js';
import { fitJpeg, toCameraImage } from './image.js';
import {
  CAMERA_FEATURES,
  CAMERA_TYPE,
  buildCameraDevice,
  cameraIds,
  cameraStatusStates,
  cameraTransport,
} from './devices/camera.js';
import {
  ALARM_FEATURES,
  ALARM_MODES,
  ALARM_SENSOR_TYPE,
  ALARM_TYPE,
  alarmIds,
  buildAlarmDevice,
  buildSensorDevice,
  modeFromRing,
  sensorIds,
  sensorStates,
} from './devices/alarm.js';

const logger = createLogger({ name: 'app' });

// Scene trigger keys, as declared in the manifest `scene_triggers`.
export const SCENE_TRIGGERS = {
  DOORBELL_PRESSED: 'doorbell_pressed',
  MOTION_DETECTED: 'motion_detected',
  ALARM_MODE_CHANGED: 'alarm_mode_changed',
};

// A press shows "Ringing" this long on the Gladys device card.
export const DING_PULSE_MS = 15_000;
// A motion stays "detected" this long after the last notification (a Ring
// motion event lasts about a minute, the library's own value is 65 s).
export const MOTION_HOLD_MS = 60_000;
// A snapshot younger than this is served as is to a live view request.
export const LIVE_IMAGE_MAX_AGE_MS = 30_000;
// Retry delays when Ring cannot be reached, or refuses the token (a refused
// token is retried slowly: a Ring outage can look like one).
export const RETRY_UNREACHABLE_MS = 5 * 60_000;
export const RETRY_AUTH_MS = 30 * 60_000;

/**
 * @param {object} deps
 * @param {object} deps.gladys SDK client
 * @param {string} deps.dataDir writable folder (/data)
 * @param {(options: object) => object} [deps.createRingApi]
 * @param {(options: object) => object} [deps.createRestClient]
 * @param {() => number} [deps.now]
 */
export function createApp({ gladys, dataDir, createRingApi, createRestClient, now = Date.now }) {
  const tokens = createTokenStore(dataDir);
  const signIn = createSignIn({
    createRestClient: createRestClient ?? defaultCreateRestClient,
    systemId: () => tokens.systemId(),
    now,
  });
  const states = createStatePublisher(gladys);
  const events = createEventLog(dataDir);
  const snapshots = new Map(); // camera id -> { buffer, at, key }
  const inFlightSnapshots = new Map();
  const timers = new Map(); // pulse / hold timers, by feature external id
  const transports = new Map(); // device external id -> last published transport
  const alarmModes = new Map(); // location id -> last Gladys mode seen

  let config = normalizeConfig();
  let session = null;
  let status = 'idle'; // idle | connecting | connected | missing | revoked | unreachable
  let retryTimer = null;
  let snapshotTimer = null;
  let generation = 0; // bumps on every (re)connection to Ring, drops late results
  let onWidgetChange = () => {};

  // --- Connection status ----------------------------------------------------

  async function reportStatus() {
    const messages = {
      missing: TEXTS.statusNoToken,
      revoked: TEXTS.statusRevoked,
      unreachable: TEXTS.statusUnreachable,
    };
    try {
      if (status === 'connected') {
        await gladys.setConnectionStatus(true);
      } else if (messages[status]) {
        await gladys.setConnectionStatus(false, messages[status]);
      }
    } catch (err) {
      logger.warn(`Connection status not published: ${err.message}`);
    }
  }

  // --- Ring session lifecycle -----------------------------------------------

  function stopRing() {
    generation += 1;
    clearTimeout(retryTimer);
    retryTimer = null;
    clearInterval(snapshotTimer);
    snapshotTimer = null;
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    session?.stop();
    session = null;
  }

  function scheduleRetry(delay) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      connectRing().catch((err) => logger.error('Ring reconnection failed', err));
    }, delay);
    retryTimer.unref?.();
  }

  async function connectRing() {
    stopRing();
    const myGeneration = generation;
    const { token } = await tokens.resolve(config.refresh_token);
    if (!token) {
      status = 'missing';
      await reportStatus();
      return;
    }
    status = 'connecting';
    const next = new RingSession({ createRingApi });
    try {
      await next.start({
        refreshToken: token,
        systemId: await tokens.systemId(),
        onToken: (newToken) => {
          tokens.rotate(newToken).catch((err) => logger.error('Ring token not saved', err));
        },
      });
    } catch (err) {
      next.stop();
      if (myGeneration !== generation) {
        return;
      }
      if (err instanceof RingAuthError) {
        // Never log the token, nor the library's error body.
        logger.error('Ring refused the refresh token: sign in again.');
        status = 'revoked';
        scheduleRetry(RETRY_AUTH_MS);
      } else {
        logger.warn(`Ring unreachable (${err.message}), retrying in 5 minutes`);
        status = 'unreachable';
        scheduleRetry(RETRY_UNREACHABLE_MS);
      }
      await reportStatus();
      return;
    }
    if (myGeneration !== generation) {
      next.stop();
      return;
    }
    session = next;
    status = 'connected';
    const cameras = session.cameras.length;
    const sensors = session.locations.reduce((n, l) => n + l.sensors.length, 0);
    logger.info(
      `Connected to Ring: ${session.locations.length} location(s), ${cameras} camera(s), ${sensors} alarm sensor(s)`,
    );
    await publishDevices();
    subscribe(session);
    startSnapshotTimer();
    await reportStatus();
    onWidgetChange();
  }

  // --- Discovery ------------------------------------------------------------

  function discoveredDevices() {
    if (!session) {
      return [];
    }
    const devices = [];
    for (const location of session.locations) {
      for (const camera of location.cameras) {
        devices.push(
          buildCameraDevice(
            gladys,
            { data: camera.data, isDoorbot: camera.isDoorbot },
            config.language,
          ),
        );
      }
      if (location.panel) {
        devices.push(
          buildAlarmDevice(
            gladys,
            { locationId: location.id, locationName: location.name },
            { language: config.language, allowControl: config.allow_alarm_control },
          ),
        );
      }
      for (const sensor of location.sensors) {
        devices.push(buildSensorDevice(gladys, sensor.data, config.language));
      }
    }
    return devices;
  }

  async function publishDevices() {
    if (!session) {
      return;
    }
    try {
      await gladys.publishDiscoveredDevices(discoveredDevices());
    } catch (err) {
      logger.error('Discovered devices not published', err);
    }
  }

  // --- Ring -> Gladys -------------------------------------------------------

  async function publishTransport(deviceExternalId, transport) {
    if (transports.get(deviceExternalId) === transport) {
      return;
    }
    try {
      await gladys.publishTransports([{ external_id: deviceExternalId, transport }]);
      transports.set(deviceExternalId, transport);
    } catch (err) {
      logger.warn(`Transport of ${deviceExternalId} not published: ${err.message}`);
    }
  }

  async function onCameraData(camera, data) {
    const ids = cameraIds(gladys, camera.id);
    const before = [CAMERA_FEATURES.LIGHT, CAMERA_FEATURES.SIREN].map((key) =>
      states.get(ids.feature(key)),
    );
    for (const [key, value] of cameraStatusStates(data, camera.isDoorbot)) {
      await states.publish(ids.feature(key), value);
    }
    await publishTransport(ids.device, cameraTransport(data));
    const after = [CAMERA_FEATURES.LIGHT, CAMERA_FEATURES.SIREN].map((key) =>
      states.get(ids.feature(key)),
    );
    if (before.some((value, i) => value !== undefined && value !== after[i])) {
      onWidgetChange();
    }
  }

  function pulse(featureExternalId, holdMs) {
    clearTimeout(timers.get(featureExternalId));
    states.publish(featureExternalId, 1).catch(() => {});
    const timer = setTimeout(() => {
      timers.delete(featureExternalId);
      states.publish(featureExternalId, 0).catch(() => {});
    }, holdMs);
    timer.unref?.();
    timers.set(featureExternalId, timer);
  }

  async function fireSceneEvent(key, data) {
    try {
      await gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} not accepted: ${err.message}`);
    }
  }

  async function onNotification(camera, notification) {
    const event = parseNotification(notification);
    if (!event) {
      return;
    }
    if (!(await events.record(String(camera.id), event))) {
      return;
    }
    const ids = cameraIds(gladys, camera.id);
    const deviceName = camera.name ?? camera.data?.description ?? '';
    if (event.kind === 'ding') {
      logger.info(`Doorbell pressed: ${deviceName}`);
      pulse(ids.feature(CAMERA_FEATURES.DING), DING_PULSE_MS);
      await fireSceneEvent(SCENE_TRIGGERS.DOORBELL_PRESSED, {
        device: ids.device,
        device_name: deviceName,
      });
    } else {
      logger.info(`Motion (${event.detection}): ${deviceName}`);
      pulse(ids.feature(CAMERA_FEATURES.MOTION), MOTION_HOLD_MS);
      await fireSceneEvent(SCENE_TRIGGERS.MOTION_DETECTED, {
        device: ids.device,
        device_name: deviceName,
        detection: event.detection,
      });
    }
    onWidgetChange();
    // The picture of the event itself, when Ring attached one.
    refreshSnapshot(camera, { uuid: event.snapshotUuid, publish: true }).catch((err) =>
      logger.debug(`Event snapshot of ${deviceName} not fetched: ${err.message}`),
    );
  }

  async function onPanelData(location, data) {
    const ids = alarmIds(gladys, location.id);
    const mode = modeFromRing(data.mode);
    if (!mode) {
      return;
    }
    await states.publish(ids.feature(ALARM_FEATURES.MODE), { text: mode });
    const previous = alarmModes.get(location.id);
    alarmModes.set(location.id, mode);
    // The first value is the state at connection, not a change.
    if (previous !== undefined && previous !== mode) {
      logger.info(`Ring Alarm mode of "${location.name}": ${previous} -> ${mode}`);
      await fireSceneEvent(SCENE_TRIGGERS.ALARM_MODE_CHANGED, {
        device: ids.device,
        mode,
        previous_mode: previous,
        location_name: location.name ?? '',
      });
    }
  }

  async function onSensorData(data) {
    const ids = sensorIds(gladys, data.zid);
    for (const [key, value] of sensorStates(data)) {
      await states.publish(ids.feature(key), value);
    }
  }

  // Each subscription handler runs one at a time per source: a burst of
  // updates is published in order.
  function serialized(handler) {
    let chain = Promise.resolve();
    return (...args) => {
      chain = chain
        .then(() => handler(...args))
        .catch((err) => logger.error('Ring update not handled', err));
    };
  }

  function subscribe(current) {
    for (const location of current.locations) {
      for (const camera of location.cameras) {
        current.track(camera.onData.subscribe(serialized((data) => onCameraData(camera, data))));
        current.track(
          camera.onNewNotification.subscribe(serialized((n) => onNotification(camera, n))),
        );
      }
      if (location.panel) {
        current.track(
          location.panel.onData.subscribe(serialized((data) => onPanelData(location, data))),
        );
      }
      for (const sensor of location.sensors) {
        current.track(sensor.onData.subscribe(serialized(onSensorData)));
      }
    }
  }

  // --- Snapshots ------------------------------------------------------------

  async function publishCameraImage(camera, buffer) {
    const { device } = cameraIds(gladys, camera.id);
    if (Array.isArray(gladys.devices) && !gladys.devices.some((d) => d.external_id === device)) {
      return;
    }
    try {
      await gladys.publishCameraImage(device, toCameraImage(buffer));
    } catch (err) {
      logger.warn(`Snapshot of ${camera.name} not published: ${err.message}`);
    }
  }

  /**
   * Ask Ring for a snapshot (ring-client-api reuses a recent one, and spares
   * the battery cameras), fit it to the Gladys limits and keep it.
   */
  async function refreshSnapshot(camera, { uuid, publish = false } = {}) {
    const key = `${camera.id}:${uuid ?? ''}`;
    if (!inFlightSnapshots.has(key)) {
      const myGeneration = generation;
      const promise = (async () => {
        const raw = await camera.getSnapshot(uuid ? { uuid } : undefined);
        const buffer = await fitJpeg(Buffer.from(raw));
        const hash = createHash('sha1').update(buffer).digest('hex').slice(0, 12);
        const entry = { buffer, at: now(), key: `snapshot-${camera.id}-${hash}` };
        if (myGeneration === generation) {
          snapshots.set(String(camera.id), entry);
          if (publish) {
            await publishCameraImage(camera, buffer);
          }
          onWidgetChange();
        }
        return entry;
      })().finally(() => inFlightSnapshots.delete(key));
      inFlightSnapshots.set(key, promise);
    }
    return inFlightSnapshots.get(key);
  }

  function startSnapshotTimer() {
    clearInterval(snapshotTimer);
    snapshotTimer = null;
    if (!config.snapshotIntervalMinutes) {
      return;
    }
    snapshotTimer = setInterval(async () => {
      // One camera after the other: a burst of snapshot requests is the kind
      // of traffic a cloud API frowns upon.
      for (const camera of session?.cameras ?? []) {
        if (camera.data?.alerts?.connection === 'offline') {
          continue;
        }
        try {
          await refreshSnapshot(camera, { publish: true });
        } catch (err) {
          logger.debug(`Periodic snapshot of ${camera.name} skipped: ${err.message}`);
        }
      }
    }, config.snapshotIntervalMinutes * 60_000);
    snapshotTimer.unref?.();
  }

  // --- Lookups from Gladys external ids -------------------------------------

  /** `{ type, id, key }` from a device or feature external id of ours. */
  function parseExternalId(externalId) {
    for (const type of [ALARM_SENSOR_TYPE, ALARM_TYPE, CAMERA_TYPE]) {
      const prefix = gladys.externalIds(type, '').device;
      if (externalId.startsWith(prefix)) {
        const [id, key] = externalId.slice(prefix.length).split(':');
        return { type, id, key };
      }
    }
    return null;
  }

  function cameraOf(deviceExternalId) {
    const parsed = parseExternalId(deviceExternalId);
    if (!parsed || parsed.type !== CAMERA_TYPE) {
      return null;
    }
    return session?.findCamera(parsed.id) ?? null;
  }

  function requireSession() {
    if (!session) {
      throw new Error('Not connected to Ring');
    }
    return session;
  }

  // --- Commands -------------------------------------------------------------

  async function setCameraFeature(camera, key, on) {
    const ids = cameraIds(gladys, camera.id);
    if (key === CAMERA_FEATURES.LIGHT) {
      await camera.setLight(on);
    } else if (key === CAMERA_FEATURES.SIREN) {
      await camera.setSiren(on);
    } else {
      throw new Error(`Feature ${key} cannot be controlled`);
    }
    await states.publish(ids.feature(key), on ? 1 : 0);
    onWidgetChange();
  }

  async function setAlarmMode(locationId, mode) {
    if (!config.allow_alarm_control) {
      throw new Error('Controlling the Ring Alarm is disabled in the integration configuration');
    }
    const ringMode = ALARM_MODES[mode];
    if (!ringMode) {
      throw new Error(`Unknown alarm mode: ${mode}`);
    }
    const location = requireSession().findLocation(locationId);
    if (!location?.panel) {
      throw new Error('No Ring Alarm at this location');
    }
    // Throws when Ring did not switch (a sensor needing a bypass, which only
    // the Ring app can grant).
    await location.location.setAlarmMode(ringMode);
    await states.publish(alarmIds(gladys, locationId).feature(ALARM_FEATURES.MODE), { text: mode });
  }

  async function onSetValue(device, feature, value) {
    const parsed = parseExternalId(feature.external_id);
    if (parsed?.type === CAMERA_TYPE) {
      const camera = requireSession().findCamera(parsed.id);
      if (!camera) {
        throw new Error(`Unknown Ring camera ${parsed.id}`);
      }
      await setCameraFeature(camera, parsed.key, Number(value) === 1);
      return;
    }
    if (parsed?.type === ALARM_TYPE && parsed.key === ALARM_FEATURES.MODE) {
      await setAlarmMode(parsed.id, String(value));
      return;
    }
    throw new Error(`${feature.external_id} cannot be controlled`);
  }

  async function onGetImage(device) {
    const camera = cameraOf(device.external_id);
    if (!camera) {
      throw new Error(`Unknown Ring camera ${device.external_id}`);
    }
    const cached = snapshots.get(String(camera.id));
    if (cached && now() - cached.at < LIVE_IMAGE_MAX_AGE_MS) {
      return toCameraImage(cached.buffer);
    }
    try {
      const entry = await refreshSnapshot(camera);
      return toCameraImage(entry.buffer);
    } catch (err) {
      // A stale picture beats an error on a dashboard; say why in the logs.
      if (cached) {
        logger.debug(
          `Fresh snapshot of ${camera.name} failed (${err.message}), serving the last one`,
        );
        return toCameraImage(cached.buffer);
      }
      throw err;
    }
  }

  // --- Gladys lifecycle -----------------------------------------------------

  async function onDeviceCreated(device) {
    // States published before the user created the device were dropped.
    await states.republishDevice(device.external_id);
    transports.delete(device.external_id);
    const camera = cameraOf(device.external_id);
    if (camera) {
      await publishTransport(device.external_id, cameraTransport(camera.data));
      const cached = snapshots.get(String(camera.id));
      if (cached) {
        await publishCameraImage(camera, cached.buffer);
      } else {
        refreshSnapshot(camera, { publish: true }).catch((err) =>
          logger.debug(`First snapshot of ${camera.name} not fetched: ${err.message}`),
        );
      }
    }
    onWidgetChange();
  }

  async function onGladysConnected() {
    config = normalizeConfig(await gladys.getConfig());
    await events.load();
    if (!session) {
      await connectRing();
      return;
    }
    // Gladys came back: it may have missed states and devices.
    await publishDevices();
    transports.clear();
    await states.republishAll();
    for (const camera of session.cameras) {
      await publishTransport(cameraIds(gladys, camera.id).device, cameraTransport(camera.data));
    }
    await reportStatus();
    onWidgetChange();
  }

  async function onConfigUpdated(raw) {
    const before = config;
    config = normalizeConfig(raw);
    if (before.refresh_token !== config.refresh_token || !session) {
      await connectRing();
      return;
    }
    if (before.snapshotIntervalMinutes !== config.snapshotIntervalMinutes) {
      startSnapshotTimer();
    }
    // Language and alarm control change the published devices.
    await publishDevices();
    onWidgetChange();
  }

  // --- Sign-in actions ------------------------------------------------------

  async function signedIn(token) {
    await tokens.signedIn(token, config.refresh_token);
    connectRing().catch((err) => logger.error('Ring connection failed', err));
  }

  async function sendCodeAction() {
    try {
      const result = await signIn.sendCode({ email: config.email, password: config.password });
      if (result.token) {
        await signedIn(result.token);
      }
      return result.message;
    } catch (err) {
      if (err instanceof signIn.SignInError) {
        return err.text;
      }
      throw err;
    }
  }

  async function confirmCodeAction(fields) {
    try {
      const token = await signIn.confirmCode(fields.code);
      await signedIn(token);
      return SIGN_IN_MESSAGES.signedIn;
    } catch (err) {
      if (err instanceof signIn.SignInError) {
        return err.text;
      }
      throw err;
    }
  }

  return {
    // Handlers, registered by index.js.
    onScanRequest: publishDevices,
    onSetValue,
    onGetImage,
    async onPoll(device) {
      // Devices are published with should_poll: false; kept as a fallback.
      await states.republishDevice(device.external_id);
    },
    onDeviceCreated,
    onGladysConnected,
    onConfigUpdated,
    sendCodeAction,
    confirmCodeAction,
    stop: stopRing,

    // For the widget and the scene actions.
    get config() {
      return config;
    },
    get session() {
      return session;
    },
    get status() {
      return status;
    },
    cameraOf,
    refreshSnapshot,
    publishCameraImage,
    setCameraFeature,
    setAlarmMode,
    snapshotOf: (cameraId) => snapshots.get(String(cameraId)) ?? null,
    snapshotByKey: (key) => [...snapshots.values()].find((entry) => entry.key === key) ?? null,
    lastEventsOf: (cameraId) => events.lastOf(String(cameraId)),
    stateOf: (featureExternalId) => states.get(featureExternalId),
    parseExternalId,
    setWidgetChangeListener(listener) {
      onWidgetChange = listener;
    },

    // For the tests.
    discoveredDevices,
    connectRing,
  };
}

async function defaultCreateRestClient(options) {
  const { RingRestClient } = await import('ring-client-api/rest-client');
  return new RingRestClient(options);
}
