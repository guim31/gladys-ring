// -----------------------------------------------------------------------------
// Ring Alarm: the security panel (one per location with a base station) and
// its sensors: contact, motion, flood/freeze, water, freeze, smoke, CO and the
// smoke/CO listener.
//
// Pure functions over the flattened device data ring-client-api keeps for each
// alarm device (`RingDevice.data`, fed by the location's WebSocket). Each
// sensor is read the way homebridge-ring (same repository as the library)
// reads it. The keypad, base station, range extender and glass break sensor
// are left out.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { TEXTS, pick } from '../i18n.js';

export const ALARM_TYPE = 'alarm';
export const ALARM_SENSOR_TYPE = 'alarm-sensor';

export const RING_DEVICE_TYPES = {
  SECURITY_PANEL: 'security-panel',
  CONTACT: 'sensor.contact',
  MOTION: 'sensor.motion',
  FLOOD_FREEZE: 'sensor.flood-freeze',
  WATER: 'sensor.water',
  FREEZE: 'sensor.freeze',
  SMOKE: 'alarm.smoke',
  CO: 'alarm.co',
  SMOKE_CO_LISTENER: 'listener.smoke-co',
  KIDDE_SMOKE_CO: 'comp.bluejay.sensor_bluejay_wsc',
};

// Feature keys: never rename one.
export const ALARM_FEATURES = { MODE: 'mode' };
export const SENSOR_FEATURES = {
  CONTACT: 'contact',
  MOTION: 'motion',
  LEAK: 'leak',
  FREEZE: 'freeze',
  SMOKE: 'smoke',
  CO: 'co',
  TAMPER: 'tamper',
  BATTERY: 'battery',
};

const active = (status) => (status === 'active' ? 1 : 0);
const smokeOf = (data) =>
  active(data.smoke?.alarmStatus ?? data.components?.['alarm.smoke']?.alarmStatus);
const coOf = (data) => active(data.co?.alarmStatus ?? data.components?.['alarm.co']?.alarmStatus);

// What each kind of Ring sensor reports: its detection features (key, Gladys
// category/type, name, how to read it) and its model name.
const DETECTIONS = {
  contact: {
    key: SENSOR_FEATURES.CONTACT,
    category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
    name: 'featureContact',
    read: (data) => (data.faulted ? 1 : 0),
  },
  motion: {
    key: SENSOR_FEATURES.MOTION,
    category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
    name: 'featureMotion',
    read: (data) => (data.faulted ? 1 : 0),
  },
  flood: {
    key: SENSOR_FEATURES.LEAK,
    category: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
    name: 'featureLeak',
    read: (data) => (data.flood?.faulted ? 1 : 0),
  },
  water: {
    key: SENSOR_FEATURES.LEAK,
    category: DEVICE_FEATURE_CATEGORIES.LEAK_SENSOR,
    name: 'featureLeak',
    read: (data) => (data.faulted ? 1 : 0),
  },
  // Gladys has no freeze category: a generic binary input, named "Freeze".
  freezeOfFlood: {
    key: SENSOR_FEATURES.FREEZE,
    category: DEVICE_FEATURE_CATEGORIES.INPUT,
    name: 'featureFreeze',
    read: (data) => (data.freeze?.faulted ? 1 : 0),
  },
  freeze: {
    key: SENSOR_FEATURES.FREEZE,
    category: DEVICE_FEATURE_CATEGORIES.INPUT,
    name: 'featureFreeze',
    read: (data) => (data.faulted ? 1 : 0),
  },
  smokeAlarm: {
    key: SENSOR_FEATURES.SMOKE,
    category: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
    name: 'featureSmoke',
    read: (data) => active(data.alarmStatus),
  },
  coAlarm: {
    key: SENSOR_FEATURES.CO,
    category: DEVICE_FEATURE_CATEGORIES.CO_SENSOR,
    name: 'featureCo',
    read: (data) => active(data.alarmStatus),
  },
  smoke: {
    key: SENSOR_FEATURES.SMOKE,
    category: DEVICE_FEATURE_CATEGORIES.SMOKE_SENSOR,
    name: 'featureSmoke',
    read: smokeOf,
  },
  co: {
    key: SENSOR_FEATURES.CO,
    category: DEVICE_FEATURE_CATEGORIES.CO_SENSOR,
    name: 'featureCo',
    read: coOf,
  },
};

const SENSOR_KINDS = {
  [RING_DEVICE_TYPES.CONTACT]: {
    model: 'Ring Alarm Contact Sensor',
    detections: [DETECTIONS.contact],
  },
  [RING_DEVICE_TYPES.MOTION]: {
    model: 'Ring Alarm Motion Detector',
    detections: [DETECTIONS.motion],
  },
  [RING_DEVICE_TYPES.FLOOD_FREEZE]: {
    model: 'Ring Alarm Flood & Freeze Sensor',
    detections: [DETECTIONS.flood, DETECTIONS.freezeOfFlood],
  },
  [RING_DEVICE_TYPES.WATER]: { model: 'Ring Water Sensor', detections: [DETECTIONS.water] },
  [RING_DEVICE_TYPES.FREEZE]: { model: 'Ring Freeze Sensor', detections: [DETECTIONS.freeze] },
  [RING_DEVICE_TYPES.SMOKE]: { model: 'Smoke Alarm', detections: [DETECTIONS.smokeAlarm] },
  [RING_DEVICE_TYPES.CO]: { model: 'CO Alarm', detections: [DETECTIONS.coAlarm] },
  [RING_DEVICE_TYPES.SMOKE_CO_LISTENER]: {
    model: 'Ring Alarm Smoke & CO Listener',
    detections: [DETECTIONS.smoke, DETECTIONS.co],
  },
  [RING_DEVICE_TYPES.KIDDE_SMOKE_CO]: {
    model: 'Kidde Smoke & CO Alarm',
    detections: [DETECTIONS.smoke, DETECTIONS.co],
  },
};

// Gladys-side values of the alarm mode (stored in scenes: never change one),
// and the Ring mode each one stands for.
export const ALARM_MODES = {
  disarmed: 'none',
  home: 'some',
  away: 'all',
};
const MODE_LABELS = { disarmed: 'modeDisarmed', home: 'modeHome', away: 'modeAway' };

/** Ring mode ('none' | 'some' | 'all') -> Gladys value, null when unknown. */
export function modeFromRing(ringMode) {
  return Object.keys(ALARM_MODES).find((mode) => ALARM_MODES[mode] === ringMode) ?? null;
}

export function alarmIds(gladys, locationId) {
  return gladys.externalIds(ALARM_TYPE, String(locationId));
}

export function sensorIds(gladys, zid) {
  return gladys.externalIds(ALARM_SENSOR_TYPE, String(zid));
}

export function isSupportedSensor(data) {
  return Object.hasOwn(SENSOR_KINDS, data.deviceType);
}

function sensorBattery(data) {
  const level = data.batteryLevel;
  return typeof level === 'number' && level >= 0 && level <= 100 ? Math.round(level) : null;
}

/**
 * The alarm of one location: a single `text/select` feature carrying the mode.
 * Read-only unless the user allowed the alarm control in the configuration.
 */
export function buildAlarmDevice(gladys, { locationId, locationName }, { language, allowControl }) {
  const ids = alarmIds(gladys, locationId);
  const base = pick(TEXTS.alarmDeviceName, language);
  return {
    name: locationName ? `${base} - ${locationName}` : base,
    external_id: ids.device,
    model: 'Ring Alarm',
    should_poll: false,
    features: [
      {
        name: pick(TEXTS.featureAlarmMode, language),
        external_id: ids.feature(ALARM_FEATURES.MODE),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.SELECT,
        // NOT NULL in Gladys even for a text feature.
        min: 0,
        max: 0,
        read_only: !allowControl,
        has_feedback: true,
        keep_history: true,
        supported_options: Object.keys(ALARM_MODES).map((value, index) => ({
          value,
          label: pick(TEXTS[MODE_LABELS[value]], language),
          sort_order: index,
        })),
      },
    ],
    params: [{ name: 'RING_LOCATION_ID', value: String(locationId) }],
  };
}

/** One sensor of the alarm. */
export function buildSensorDevice(gladys, data, language) {
  const ids = sensorIds(gladys, data.zid);
  const kind = SENSOR_KINDS[data.deviceType];
  const binary = (key, category, nameKey) => ({
    name: pick(TEXTS[nameKey], language),
    external_id: ids.feature(key),
    category,
    type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  });
  const features = kind.detections.map((d) => binary(d.key, d.category, d.name));
  if (data.tamperStatus !== undefined) {
    features.push(
      binary(SENSOR_FEATURES.TAMPER, DEVICE_FEATURE_CATEGORIES.TAMPER, 'featureTamper'),
    );
  }
  if (sensorBattery(data) !== null) {
    features.push({
      name: pick(TEXTS.featureBattery, language),
      external_id: ids.feature(SENSOR_FEATURES.BATTERY),
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
  return {
    name: data.name || kind.model,
    external_id: ids.device,
    model: kind.model,
    should_poll: false,
    features,
    params: [{ name: 'RING_ZID', value: String(data.zid) }],
  };
}

/** @returns {Array<[string, number]>} [featureKey, value] of a sensor */
export function sensorStates(data) {
  const kind = SENSOR_KINDS[data.deviceType];
  const states = kind.detections.map((d) => [d.key, d.read(data)]);
  if (data.tamperStatus !== undefined) {
    states.push([SENSOR_FEATURES.TAMPER, data.tamperStatus === 'tamper' ? 1 : 0]);
  }
  const battery = sensorBattery(data);
  if (battery !== null) {
    states.push([SENSOR_FEATURES.BATTERY, battery]);
  }
  return states;
}
