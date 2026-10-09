// -----------------------------------------------------------------------------
// Publishing device states to Gladys: only the changes, and everything again
// when the user creates a device.
//
// The core caps an integration at 300 states per minute and re-evaluates the
// scenes on every state: a value equal to the last one sent is not sent again.
// And a state published on a feature the user has not created yet gets a 200
// and is dropped, so states of devices Gladys does not know are only kept
// here, and sent by `republishDevice` from `onDeviceCreated`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'states' });

const sameValue = (a, b) =>
  typeof a === 'object' && typeof b === 'object' ? a?.text === b?.text : a === b;

/** The device external id of a feature external id (`<device>:<feature key>`). */
export function deviceOf(featureExternalId) {
  return featureExternalId.slice(0, featureExternalId.lastIndexOf(':'));
}

export function createStatePublisher(gladys) {
  // Latest known value of every feature, and the last one Gladys accepted.
  const current = new Map();
  const sent = new Map();

  function isCreated(deviceExternalId) {
    // `gladys.devices` is the SDK's copy of the devices the user created,
    // refreshed on every (re)connection and device-created/deleted event.
    if (!Array.isArray(gladys.devices)) {
      return true;
    }
    return gladys.devices.some((device) => device.external_id === deviceExternalId);
  }

  async function send(featureExternalId, value) {
    try {
      await gladys.publishState(featureExternalId, value);
      sent.set(featureExternalId, value);
    } catch (err) {
      logger.warn(`State of ${featureExternalId} not published: ${err.message}`);
    }
  }

  return {
    /**
     * @param {string} featureExternalId
     * @param {number|{ text: string }} value
     */
    async publish(featureExternalId, value) {
      if (value === null || value === undefined) {
        return;
      }
      current.set(featureExternalId, value);
      if (sent.has(featureExternalId) && sameValue(sent.get(featureExternalId), value)) {
        return;
      }
      if (!isCreated(deviceOf(featureExternalId))) {
        return;
      }
      await send(featureExternalId, value);
    },

    /** Send every known state of one device, changed or not. */
    async republishDevice(deviceExternalId) {
      for (const [featureExternalId, value] of current) {
        if (deviceOf(featureExternalId) === deviceExternalId) {
          await send(featureExternalId, value);
        }
      }
    },

    /** Gladys may have lost what it had (reconnection): send everything again. */
    forgetSent() {
      sent.clear();
    },

    async republishAll() {
      sent.clear();
      for (const [featureExternalId, value] of current) {
        if (isCreated(deviceOf(featureExternalId))) {
          await send(featureExternalId, value);
        }
      }
    },

    get(featureExternalId) {
      return current.get(featureExternalId);
    },
  };
}
