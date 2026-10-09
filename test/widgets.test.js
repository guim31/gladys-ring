import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import {
  DOORBELL_ACTIONS,
  buildDoorbellContent,
  doorbellImage,
  formatWhen,
  refreshWidgets,
  runDoorbellAction,
} from '../src/widgets.js';
import { NOTIFICATIONS } from './helpers/fakeRing.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { setup, waitFor } from './helpers/setup.js';

const cam = (id) => `ext:ring:camera:${id}`;
const content = (gladys, app, camera, language = 'en') =>
  buildDoorbellContent(gladys, app, { settings: { camera }, language, units: 'us' });

test('every camera of the fixtures gives a content rendered exactly as sent', async () => {
  const { gladys, app, account } = await setup();
  await waitFor(() => account.cameras.every((c) => app.snapshotOf(c.id)), 'snapshots not taken');
  for (const camera of account.cameras) {
    for (const language of ['en', 'fr']) {
      const result = content(gladys, app, cam(camera.id), language);
      assert.deepEqual(validateWidgetContent(result), [], `${camera.name} (${language})`);
    }
  }
  app.stop();
});

test('the live tiles and buttons reference features the integration publishes', async () => {
  const { gladys, app } = await setup();
  const featureIds = new Set(
    gladys.discovered.flatMap((d) => d.features.map((f) => f.external_id)),
  );
  const writable = new Set(
    gladys.discovered.flatMap((d) =>
      d.features.filter((f) => !f.read_only).map((f) => f.external_id),
    ),
  );
  for (const device of gladys.discovered.filter((d) => d.external_id.includes(':camera:'))) {
    for (const component of content(gladys, app, device.external_id).components) {
      if (component.device_feature) {
        assert.ok(featureIds.has(component.device_feature), component.device_feature);
        if (component.type === 'button') {
          assert.ok(
            writable.has(component.device_feature),
            `${component.device_feature} is read-only`,
          );
        }
      }
    }
  }
  app.stop();
});

test('the floodlight content has the snapshot, the light buttons and a confirmed siren', async () => {
  const { gladys, app, account } = await setup();
  await waitFor(() => app.snapshotOf(10000003), 'no snapshot');
  const { components } = content(gladys, app, cam(10000003));
  const image = components.find((c) => c.type === 'image');
  assert.match(image.key, /^snapshot-10000003-[0-9a-f]{12}$/);
  const buttons = components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => b.action?.key ?? `${b.device_feature.split(':').at(-1)}=${b.value}`),
    [DOORBELL_ACTIONS.REFRESH, 'light=1', 'light=0', DOORBELL_ACTIONS.SIREN_ON],
  );
  assert.equal(buttons[3].action.confirm, true, 'the siren asks for a confirmation');

  // The image key resolves to a valid widget image.
  const base64 = doorbellImage(app, image.key);
  assert.deepEqual(validateWidgetImage(base64), []);
  assert.throws(() => doorbellImage(app, 'snapshot-unknown'));

  // Siren sounding: the button stops it instead.
  await runDoorbellAction(app, {
    actionKey: DOORBELL_ACTIONS.SIREN_ON,
    params: { camera: cam(10000003) },
  });
  const driveway = account.cameras.find((c) => c.id === 10000003);
  assert.deepEqual(driveway.calls.at(-1), ['setSiren', true]);
  const after = content(gladys, app, cam(10000003)).components.filter((c) => c.type === 'button');
  assert.equal(after.at(-1).action.key, DOORBELL_ACTIONS.SIREN_OFF);
  const toast = await runDoorbellAction(app, {
    actionKey: DOORBELL_ACTIONS.SIREN_OFF,
    params: { camera: cam(10000003) },
  });
  assert.ok(toast.en.length <= 200 && toast.fr);
  app.stop();
});

test('the last ring and motion appear with their time', async () => {
  const { gladys, app, account } = await setup();
  account.cameras.find((c) => c.id === 10000001).onNewNotification.next(NOTIFICATIONS.ding);
  await waitFor(() => app.lastEventsOf(10000001).ding, 'ding not recorded');
  const status = content(gladys, app, cam(10000001)).components.find((c) => c.type === 'status');
  const ring = status.items.find((item) => item.label.en === 'Last ring');
  assert.equal(ring.value, formatWhen(NOTIFICATIONS.ding.data.event.ding.created_at, 'en'));
  app.stop();
});

test('a refresh action takes a new snapshot; unknown actions and cameras fail', async () => {
  const { app } = await setup();
  const toast = await runDoorbellAction(app, {
    actionKey: DOORBELL_ACTIONS.REFRESH,
    params: { camera: cam(10000002) },
  });
  assert.equal(toast.en, 'Snapshot updated.');
  await assert.rejects(
    runDoorbellAction(app, { actionKey: 'nope', params: { camera: cam(10000002) } }),
  );
  await assert.rejects(runDoorbellAction(app, { actionKey: DOORBELL_ACTIONS.REFRESH, params: {} }));
  app.stop();
});

test('a widget without a camera, or without Ring, explains what to do', async () => {
  const { gladys, app } = await setup({ createAll: false });
  const none = buildDoorbellContent(gladys, app, { settings: {}, language: 'en' });
  assert.deepEqual(validateWidgetContent(none), []);
  assert.match(none.components[0].text.en, /Choose a Ring camera/);
  const alarm = content(gladys, app, 'ext:ring:alarm:loc-0001');
  assert.match(alarm.components[0].text.en, /Choose a Ring camera/);
  app.stop();
  const offline = buildDoorbellContent(gladys, app, {
    settings: { camera: cam(1) },
    language: 'fr',
  });
  assert.match(offline.components[0].text.fr, /Pas connecté/);
});

test('dates fit a status value in both languages', () => {
  for (const language of ['en', 'fr', 'de']) {
    const text = formatWhen('2026-12-31T23:59:00Z', language);
    assert.ok(text && text.length <= 40, `${language}: ${text}`);
  }
  assert.equal(formatWhen('not a date', 'en'), null);
});

test('refreshWidgets nudges the doorbell widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.widgetRefreshes, ['doorbell']);
});
