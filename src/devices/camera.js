// -----------------------------------------------------------------------------
// Ring doorbells and cameras (doorbells, Stick Up Cam, Spotlight Cam,
// Floodlight Cam, Indoor Cam...).
//
// Pure functions over the raw device data Ring returns from
// `clients_api/ring_devices` (the `CameraData` of ring-client-api): what a
// camera can do is read from that data, exactly like ring-client-api and the
// Home Assistant integration do, never from a model list that would lag
// behind Ring's new models.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { TEXTS, pick } from '../i18n.js';

// External id type of a camera: `ext:<selector>:camera:<Ring device id>`.
export const CAMERA_TYPE = 'camera';

// Feature keys: stored by Gladys with the history, scenes and dashboards that
// use them. Never rename one.
export const CAMERA_FEATURES = {
  SNAPSHOT: 'snapshot',
  DING: 'ding',
  MOTION: 'motion',
  BATTERY: 'battery',
  LIGHT: 'light',
  SIREN: 'siren',
};

// Names ring-client-api gives the camera kinds, for the device `model`.
const MODEL_NAMES = {
  doorbot: 'Video Doorbell',
  doorbell: 'Video Doorbell',
  doorbell_v3: 'Video Doorbell',
  doorbell_v4: 'Video Doorbell 2',
  doorbell_v5: 'Video Doorbell 2',
  doorbell_oyster: 'Video Doorbell 4',
  doorbell_portal: 'Door View Cam',
  doorbell_scallop: 'Video Doorbell 3 Plus',
  doorbell_scallop_lite: 'Video Doorbell 3',
  doorbell_graham_cracker: 'Video Doorbell Wired',
  lpd_v1: 'Video Doorbell Pro',
  lpd_v2: 'Video Doorbell Pro',
  lpd_v4: 'Video Doorbell Pro 2',
  jbox_v1: 'Video Doorbell Elite',
  stickup_cam: 'Stick Up Cam',
  stickup_cam_v3: 'Stick Up Cam',
  stickup_cam_elite: 'Stick Up Cam',
  stickup_cam_lunar: 'Stick Up Cam',
  stickup_cam_longfin: 'Spotlight Cam Pro',
  spotlightw_v2: 'Spotlight Cam',
  hp_cam_v1: 'Floodlight Cam',
  hp_cam_v2: 'Spotlight Cam',
  stickup_cam_v4: 'Spotlight Cam',
  floodlight_v1: 'Floodlight Cam',
  floodlight_v2: 'Floodlight Cam',
  floodlight_pro: 'Floodlight Cam Pro',
  cocoa_camera: 'Stick Up Cam',
  cocoa_doorbell: 'Battery Doorbell',
  cocoa_doorbell_v2: 'Battery Doorbell Plus',
  cocoa_doorbell_v3: 'Battery Doorbell Pro',
  cocoa_floodlight: 'Floodlight Cam Plus',
  cocoa_spotlight: 'Spotlight Cam Plus',
  stickup_cam_mini: 'Indoor Cam',
};

export function modelName(kind) {
  return `Ring ${MODEL_NAMES[kind] ?? 'Camera'}`;
}

function parseLevel(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const level = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(level) ? level : null;
}

/**
 * Battery level in percent, or null when the camera has no battery.
 *
 * Same rule as ring-client-api (the lowest of the two packs of a dual-battery
 * camera), plus one: wired doorbells such as the Video Doorbell Pro report a
 * raw value above 100 (4081 in the Home Assistant fixtures), which is not a
 * percentage and means "no battery to show".
 */
export function batteryLevel(data) {
  const levels = [parseLevel(data.battery_life), parseLevel(data.battery_life_2)].filter(
    (level) => level !== null,
  );
  if (levels.length === 0) {
    return null;
  }
  const level = Math.min(...levels);
  if (level < 0 || level > 100) {
    return null;
  }
  return Math.round(level);
}

/**
 * What a camera can do, from its data. `isDoorbot` comes from ring-client-api
 * (listed under `doorbots`/`authorized_doorbots`, or a `doorbell*` kind).
 */
export function cameraCapabilities(data, isDoorbot) {
  return {
    doorbell: Boolean(isDoorbot),
    battery: batteryLevel(data) !== null,
    // ring-client-api's own test (`hasLight`, `hasSiren`).
    light: data.led_status !== undefined && data.led_status !== null,
    siren: data.siren_status !== undefined && data.siren_status !== null,
  };
}

export function cameraIds(gladys, cameraId) {
  return gladys.externalIds(CAMERA_TYPE, String(cameraId));
}

/**
 * The Gladys discovery payload of one camera.
 * @param {object} gladys SDK client (for the external ids)
 * @param {{ data: object, isDoorbot: boolean }} camera
 * @param {string} language feature names are frozen at creation: pick one
 */
export function buildCameraDevice(gladys, { data, isDoorbot }, language) {
  const ids = cameraIds(gladys, data.id);
  const can = cameraCapabilities(data, isDoorbot);
  const name = (key) => pick(TEXTS[key], language);
  const features = [
    {
      name: name('featureSnapshot'),
      external_id: ids.feature(CAMERA_FEATURES.SNAPSHOT),
      category: DEVICE_FEATURE_CATEGORIES.CAMERA,
      type: DEVICE_FEATURE_TYPES.CAMERA.IMAGE,
      min: 0,
      max: 0,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
  ];
  if (can.doorbell) {
    // A press is a 1 -> 0 pulse: the Gladys doorbell renderer shows "Ringing"
    // while 1, then the time of the last press.
    features.push({
      name: name('featureDing'),
      external_id: ids.feature(CAMERA_FEATURES.DING),
      category: DEVICE_FEATURE_CATEGORIES.DOORBELL,
      type: DEVICE_FEATURE_TYPES.DOORBELL.RING,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }
  features.push({
    name: name('featureMotion'),
    external_id: ids.feature(CAMERA_FEATURES.MOTION),
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });
  if (can.battery) {
    features.push({
      name: name('featureBattery'),
      external_id: ids.feature(CAMERA_FEATURES.BATTERY),
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: 'percent',
      min: 0,
      max: 100,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    });
  }
  if (can.light) {
    features.push({
      name: name('featureLight'),
      external_id: ids.feature(CAMERA_FEATURES.LIGHT),
      category: DEVICE_FEATURE_CATEGORIES.LIGHT,
      type: DEVICE_FEATURE_TYPES.LIGHT.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    });
  }
  if (can.siren) {
    features.push({
      name: name('featureSiren'),
      external_id: ids.feature(CAMERA_FEATURES.SIREN),
      category: DEVICE_FEATURE_CATEGORIES.SIREN,
      type: DEVICE_FEATURE_TYPES.SIREN.BINARY,
      min: 0,
      max: 1,
      read_only: false,
      has_feedback: true,
      keep_history: true,
    });
  }
  return {
    name: data.description || modelName(data.kind),
    external_id: ids.device,
    model: modelName(data.kind),
    // Events arrive by push and the status by the container's own 60 s
    // refresh (src/ring/session.js): Gladys never polls.
    should_poll: false,
    features,
    params: [{ name: 'RING_KIND', value: String(data.kind) }],
  };
}

/**
 * The current numeric states of a camera's status features, from its data
 * (the ding and motion pulses come from the push events, not from here).
 * @returns {Array<[string, number]>} [featureKey, value]
 */
export function cameraStatusStates(data, isDoorbot) {
  const can = cameraCapabilities(data, isDoorbot);
  const states = [];
  if (can.battery) {
    states.push([CAMERA_FEATURES.BATTERY, batteryLevel(data)]);
  }
  if (can.light) {
    states.push([CAMERA_FEATURES.LIGHT, data.led_status === 'on' ? 1 : 0]);
  }
  if (can.siren) {
    states.push([CAMERA_FEATURES.SIREN, (data.siren_status?.seconds_remaining ?? 0) > 0 ? 1 : 0]);
  }
  return states;
}

/** Offline cameras show as `unreachable` on their Gladys transport badge. */
export function cameraTransport(data) {
  return data.alerts?.connection === 'offline' ? 'unreachable' : 'cloud';
}
