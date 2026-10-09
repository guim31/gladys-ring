import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { TOKEN, setup } from './helpers/setup.js';

test('take_snapshot publishes a fresh image on the camera and says so', async () => {
  const { app, gladys } = await setup();
  const before = gladys.cameraImages.length;
  const outputs = await SCENE_ACTIONS.take_snapshot(app, {
    fields: { camera: 'ext:ring:camera:10000002' },
  });
  assert.equal(outputs.captured, true);
  assert.ok(!Number.isNaN(Date.parse(outputs.taken_at)));
  assert.equal(gladys.cameraImages.length, before + 1);
  assert.equal(gladys.cameraImages.at(-1).deviceExternalId, 'ext:ring:camera:10000002');
  app.stop();
});

test('take_snapshot reports a failed capture as an output, not as an error', async () => {
  const { app, account } = await setup();
  account.cameras.find((c) => c.id === 10000005).snapshotError = new Error('offline');
  // The scene goes on: the author gates the next action on `captured`.
  const outputs = await SCENE_ACTIONS.take_snapshot(app, {
    fields: { camera: 'ext:ring:camera:10000005' },
  });
  assert.deepEqual(outputs, { captured: false, taken_at: '' });
  await assert.rejects(
    SCENE_ACTIONS.take_snapshot(app, { fields: { camera: 'ext:ring:alarm:loc-0001' } }),
  );
  app.stop();
});

test('set_alarm_mode needs the control allowed, then switches the Ring mode', async () => {
  const locked = await setup();
  await assert.rejects(
    SCENE_ACTIONS.set_alarm_mode(locked.app, {
      fields: { alarm: 'ext:ring:alarm:loc-0001', mode: 'home' },
    }),
    /disabled/,
  );
  locked.app.stop();

  const { app, account } = await setup({
    config: { refresh_token: TOKEN, allow_alarm_control: true },
  });
  const outputs = await SCENE_ACTIONS.set_alarm_mode(app, {
    fields: { alarm: 'ext:ring:alarm:loc-0001', mode: 'home' },
  });
  assert.deepEqual(outputs, { mode: 'home' });
  assert.deepEqual(account.locations[0].modeCalls, ['some']);
  await assert.rejects(
    SCENE_ACTIONS.set_alarm_mode(app, {
      fields: { alarm: 'ext:ring:camera:10000001', mode: 'home' },
    }),
    /Choose a Ring Alarm/,
  );
  app.stop();
});
