// -----------------------------------------------------------------------------
// Ring Alarm: the security panel (one per location with a base station) and
// its contact and motion sensors.
//
// Pure functions over the flattened device data ring-client-api keeps for each
// alarm device (`RingDevice.data`, fed by the location's WebSocket). Other
// alarm devices (keypad, base station, range extender, flood/freeze, smoke...)
// are deliberately left out of this first version.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { TEXTS, pick } from '../i18n.js';

export const ALARM_TYPE = 'alarm';
export const ALARM_SENSOR_TYPE = 'alarm-sensor';

export const RING_DEVICE_TYPES = {
  SECURITY_PANEL: 'security-panel',
  CONTACT: 'sensor.contact',
  MOTION: 'sensor.motion',
};

// Feature keys: never rename one.
export const ALARM_FEATURES = { MODE: 'mode' };
export const SENSOR_FEATURES = {
  CONTACT: 'contact',
  MOTION: 'motion',
  TAMPER: 'tamper',
  BATTERY: 'battery',
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
  return (
    data.deviceType === RING_DEVICE_TYPES.CONTACT || data.deviceType === RING_DEVICE_TYPES.MOTION
  );
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

/** One contact or motion sensor of the alarm. */
export function buildSensorDevice(gladys, data, language) {
  const ids = sensorIds(gladys, data.zid);
  const isContact = data.deviceType === RING_DEVICE_TYPES.CONTACT;
  const features = [
    isContact
      ? {
          name: pick(TEXTS.featureContact, language),
          external_id: ids.feature(SENSOR_FEATURES.CONTACT),
          category: DEVICE_FEATURE_CATEGORIES.OPENING_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        }
      : {
          name: pick(TEXTS.featureMotion, language),
          external_id: ids.feature(SENSOR_FEATURES.MOTION),
          category: DEVICE_FEATURE_CATEGORIES.MOTION_SENSOR,
          type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
          min: 0,
          max: 1,
          read_only: true,
          has_feedback: false,
          keep_history: true,
        },
    {
      name: pick(TEXTS.featureTamper, language),
      external_id: ids.feature(SENSOR_FEATURES.TAMPER),
      category: DEVICE_FEATURE_CATEGORIES.TAMPER,
      type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
      min: 0,
      max: 1,
      read_only: true,
      has_feedback: false,
      keep_history: true,
    },
  ];
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
    name: data.name || (isContact ? 'Ring Contact Sensor' : 'Ring Motion Detector'),
    external_id: ids.device,
    model: isContact ? 'Ring Alarm Contact Sensor' : 'Ring Alarm Motion Detector',
    should_poll: false,
    features,
    params: [{ name: 'RING_ZID', value: String(data.zid) }],
  };
}

/** @returns {Array<[string, number]>} [featureKey, value] of a sensor */
export function sensorStates(data) {
  const states = [
    [
      data.deviceType === RING_DEVICE_TYPES.CONTACT
        ? SENSOR_FEATURES.CONTACT
        : SENSOR_FEATURES.MOTION,
      data.faulted ? 1 : 0,
    ],
    [SENSOR_FEATURES.TAMPER, data.tamperStatus === 'tamper' ? 1 : 0],
  ];
  const battery = sensorBattery(data);
  if (battery !== null) {
    states.push([SENSOR_FEATURES.BATTERY, battery]);
  }
  return states;
}
