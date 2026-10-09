// -----------------------------------------------------------------------------
// Scene actions (Gladys 5.1+), declared in the manifest `scene_actions`.
//
//   take_snapshot  — publish a fresh snapshot on the camera device, so the
//                    next action of the scene (the core's "send a camera
//                    image") sends it: "someone rang -> picture on my phone";
//   set_alarm_mode — arm or disarm the Ring Alarm, only when the user allowed
//                    the alarm control in the configuration.
//
// The scene triggers (doorbell_pressed, motion_detected, alarm_mode_changed)
// are fired by src/app.js from the Ring push notifications. Never fire one as
// a consequence of an action received here: a scene bound to it would loop.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ALARM_TYPE } from './devices/alarm.js';

const logger = createLogger({ name: 'scenes' });

export const SCENE_ACTIONS = {
  async take_snapshot(app, { fields }) {
    const camera = app.cameraOf(fields.camera ?? '');
    if (!camera) {
      throw new Error('Choose a Ring camera');
    }
    logger.info(`Scene action take_snapshot <- ${camera.name}`);
    try {
      const entry = await app.refreshSnapshot(camera, { publish: true });
      return { captured: true, taken_at: new Date(entry.at).toISOString() };
    } catch (err) {
      // An action never fails the scene for a picture: the author can gate
      // the next step on `captured`.
      logger.warn(`Snapshot of ${camera.name} failed: ${err.message}`);
      return { captured: false, taken_at: '' };
    }
  },

  async set_alarm_mode(app, { fields }) {
    const parsed = app.parseExternalId(fields.alarm ?? '');
    if (!parsed || parsed.type !== ALARM_TYPE) {
      throw new Error('Choose a Ring Alarm');
    }
    logger.info(`Scene action set_alarm_mode <- ${fields.mode}`);
    await app.setAlarmMode(parsed.id, fields.mode);
    return { mode: fields.mode };
  },
};
