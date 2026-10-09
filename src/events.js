// -----------------------------------------------------------------------------
// Ring push notifications: what they mean for Gladys, and the last ones seen.
//
// The notification format is the v2 one ring-client-api parses
// (`PushNotificationDingV2`): `android_config.category` tells a doorbell press
// from a motion, `data.event.ding` carries its id, date and the kind of motion
// Ring's smart alerts recognized. The last press and the last motion of every
// camera are kept in /data, so the dashboard widget still shows them after a
// restart without asking Ring for the history.
// -----------------------------------------------------------------------------

import { readJson, writeJson } from './storage.js';

export const NOTIFICATION_CATEGORIES = {
  DING: 'com.ring.pn.live-event.ding',
  MOTION: 'com.ring.pn.live-event.motion',
};

// Values of the `detection` scene variable and filter (stored in scenes:
// never change one). Ring's smart alerts need a Ring Protect plan; without
// one every motion is plain `motion`.
export const DETECTIONS = ['person', 'vehicle', 'package', 'motion'];

const DETECTION_BY_RING_TYPE = {
  human: 'person',
  moving_vehicle: 'vehicle',
  vehicle: 'vehicle',
  package_delivery: 'package',
  package_pickup: 'package',
};

export function detectionOf(notification) {
  const ding = notification?.data?.event?.ding ?? {};
  const type =
    ding.detection_type && ding.detection_type !== 'null' ? ding.detection_type : ding.subtype;
  return DETECTION_BY_RING_TYPE[type] ?? 'motion';
}

/**
 * @returns {{ kind: 'ding'|'motion', id: string, at: string, detection?: string, snapshotUuid?: string }|null}
 */
export function parseNotification(notification) {
  const category = notification?.android_config?.category;
  const ding = notification?.data?.event?.ding;
  if (!ding) {
    return null;
  }
  const base = {
    id: String(ding.id),
    at: ding.created_at ?? new Date().toISOString(),
    snapshotUuid: notification.img?.snapshot_uuid,
  };
  if (category === NOTIFICATION_CATEGORIES.DING) {
    return { kind: 'ding', ...base };
  }
  if (category === NOTIFICATION_CATEGORIES.MOTION) {
    return { kind: 'motion', ...base, detection: detectionOf(notification) };
  }
  return null;
}

const FILE = 'ring-events.json';

export function createEventLog(dir) {
  let last = {};
  const seenIds = [];

  return {
    async load() {
      last = (await readJson(dir, FILE)) ?? {};
    },

    /**
     * Record an event. Returns false for a notification already seen (Ring
     * can deliver the same one twice).
     */
    async record(cameraId, event) {
      if (seenIds.includes(event.id)) {
        return false;
      }
      seenIds.push(event.id);
      if (seenIds.length > 100) {
        seenIds.shift();
      }
      const entry = { ...(last[cameraId] ?? {}) };
      entry[event.kind] = {
        at: event.at,
        ...(event.detection ? { detection: event.detection } : {}),
      };
      last = { ...last, [cameraId]: entry };
      try {
        await writeJson(dir, FILE, last);
      } catch {
        // Losing the widget's "last press" on a restart is not worth failing an event.
      }
      return true;
    },

    /** @returns {{ ding?: { at: string }, motion?: { at: string, detection: string } }} */
    lastOf(cameraId) {
      return last[String(cameraId)] ?? {};
    },
  };
}
