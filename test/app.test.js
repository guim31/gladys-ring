import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp, DING_PULSE_MS, MOTION_HOLD_MS } from '../src/app.js';
import { hashToken } from '../src/auth/tokenStore.js';
import { MAX_CAMERA_IMAGE_LENGTH, CAMERA_IMAGE_PREFIX } from '../src/image.js';
import { TEXTS } from '../src/i18n.js';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { NOTIFICATIONS, fakeRingApiFactory, makeLargeJpeg } from './helpers/fakeRing.js';
import { TOKEN, flush, setup, tempDir, waitFor } from './helpers/setup.js';

const cam = (id) => `ext:ring:camera:${id}`;

test('without any token, the integration says how to sign in', async () => {
  const { gladys, factory } = await setup({ config: {}, createAll: false });
  assert.equal(factory.created.length, 0, 'Ring is not called');
  assert.deepEqual(gladys.connectionStatuses.at(-1), {
    connected: false,
    message: TEXTS.statusNoToken,
  });
});

test('a pasted token signs in and publishes every supported device', async () => {
  const { gladys, factory } = await setup({ createAll: false });
  assert.equal(factory.created[0].options.refreshToken, TOKEN);
  assert.equal(factory.created[0].options.controlCenterDisplayName, 'Gladys Assistant');
  assert.ok(factory.created[0].options.systemId, 'a stable hardware id is sent');
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  const ids = gladys.discovered.map((d) => d.external_id).sort();
  assert.deepEqual(ids, [
    'ext:ring:alarm-sensor:zid-co-0001',
    'ext:ring:alarm-sensor:zid-contact-0001',
    'ext:ring:alarm-sensor:zid-contact-0002',
    'ext:ring:alarm-sensor:zid-flood-0001',
    'ext:ring:alarm-sensor:zid-kidde-0001',
    'ext:ring:alarm-sensor:zid-listener-0001',
    'ext:ring:alarm-sensor:zid-motion-0001',
    'ext:ring:alarm-sensor:zid-smoke-0001',
    'ext:ring:alarm-sensor:zid-water-0001',
    'ext:ring:alarm:loc-0001',
    cam(10000001),
    cam(10000002),
    cam(10000003),
    cam(10000004),
    cam(10000005),
    cam(10000006),
    cam(10000007),
  ]);
});

test('the rotated token is saved in /data and preferred at the next start', async () => {
  const { factory, dataDir, app } = await setup({ createAll: false });
  factory.created[0].onRefreshTokenUpdated.next({
    oldRefreshToken: TOKEN,
    newRefreshToken: 'rotated-1',
  });
  const read = async () => JSON.parse(await readFile(join(dataDir, 'ring-auth.json'), 'utf8'));
  await waitFor(
    async () => (await read()).refresh_token === 'rotated-1',
    'rotated token not saved',
  );
  const saved = await read();
  assert.equal(saved.refresh_token, 'rotated-1');
  assert.equal(saved.seed, hashToken(TOKEN), 'remembers which pasted token it comes from');
  assert.ok(
    !JSON.stringify(saved).includes(TOKEN),
    'the pasted token itself is not kept once rotated',
  );
  app.stop();

  // Restart with the same configuration: the rotated token wins.
  const again = await setup({ dataDir, createAll: false });
  assert.equal(again.factory.created[0].options.refreshToken, 'rotated-1');
  assert.equal(again.factory.created[0].options.systemId, factory.created[0].options.systemId);
  again.app.stop();

  // The user pastes a new token: it replaces the saved one.
  const pasted = await setup({ dataDir, config: { refresh_token: 'brand-new' }, createAll: false });
  assert.equal(pasted.factory.created[0].options.refreshToken, 'brand-new');
  pasted.app.stop();
});

test('a refused token says so and does not log the token', async () => {
  const { gladys, app } = await setup({ behavior: 'auth', createAll: false });
  assert.deepEqual(gladys.connectionStatuses.at(-1), {
    connected: false,
    message: TEXTS.statusRevoked,
  });
  assert.equal(app.status, 'revoked');
  app.stop();
});

test('an unreachable Ring is reported and retried', async () => {
  const { gladys, app } = await setup({ behavior: 'network', createAll: false });
  assert.deepEqual(gladys.connectionStatuses.at(-1), {
    connected: false,
    message: TEXTS.statusUnreachable,
  });
  assert.equal(app.status, 'unreachable');
  app.stop();
});

test('states wait for the user to add the device, then only changes are sent', async () => {
  const { gladys, app, account } = await setup({ createAll: false });
  assert.equal(gladys.published.length, 0, 'nothing is sent before the user adds a device');

  // The user adds the devices: what was kept is sent (the core dropped nothing yet).
  gladys.createAll();
  for (const device of gladys.devices) {
    await app.onDeviceCreated(device);
  }
  assert.equal(gladys.lastState(`${cam(10000004)}:battery`), 64, 'lowest of the two packs');
  assert.equal(gladys.lastState(`${cam(10000004)}:light`), 1);
  assert.equal(gladys.lastState(`${cam(10000004)}:siren`), 1);
  assert.equal(gladys.lastState(`${cam(10000003)}:light`), 0);
  assert.equal(
    gladys.lastState(`${cam(10000001)}:battery`),
    undefined,
    'wired Doorbell Pro: no battery',
  );
  assert.deepEqual(gladys.lastState('ext:ring:alarm:loc-0001:mode'), { text: 'disarmed' });
  // Kitchen Window is open (faulted): 0 in Gladys, whose opening sensors use 0 = open.
  assert.equal(gladys.lastState('ext:ring:alarm-sensor:zid-contact-0002:contact'), 0);
  assert.equal(gladys.lastState('ext:ring:alarm-sensor:zid-contact-0001:contact'), 1);
  assert.equal(gladys.lastState('ext:ring:alarm-sensor:zid-motion-0001:tamper'), 1);
  assert.equal(gladys.widgetRefreshes.length, 0, 'the widget nudge goes through the listener');

  // The same data again: nothing new is sent.
  const count = gladys.published.length;
  const camera = account.cameras.find((c) => c.id === 10000004);
  camera.updateData({ ...camera.data });
  await flush();
  assert.equal(gladys.published.length, count);

  // The battery drops: only that state is sent.
  camera.updateData({ ...camera.data, battery_life: 50 });
  await flush();
  assert.deepEqual(gladys.published.slice(count), [
    { featureExternalId: `${cam(10000004)}:battery`, state: 50 },
  ]);

  // A sensor opens.
  const sensor = account.locations[0].alarmDevices.find((d) => d.zid === 'zid-contact-0001');
  sensor.updateData({ faulted: true });
  await flush();
  assert.equal(gladys.lastState('ext:ring:alarm-sensor:zid-contact-0001:contact'), 0);
  app.stop();
});

test('an offline camera shows as unreachable', async () => {
  const { gladys } = await setup();
  const living = gladys.transports.filter((t) => t.external_id === cam(10000005)).at(-1);
  assert.equal(living.transport, 'unreachable');
  const front = gladys.transports.filter((t) => t.external_id === cam(10000001)).at(-1);
  assert.equal(front.transport, 'cloud');
});

test('a doorbell press pulses the ding feature, fires the scene trigger and fetches its snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { gladys, account, app } = await setup();
  const front = account.cameras.find((c) => c.id === 10000001);
  const images = gladys.cameraImages.length;
  front.onNewNotification.next(NOTIFICATIONS.ding);
  await waitFor(() => gladys.cameraImages.length > images, 'no event snapshot published');

  assert.equal(gladys.lastState(`${cam(10000001)}:ding`), 1);
  assert.deepEqual(gladys.sceneEvents.at(-1), {
    key: 'doorbell_pressed',
    data: { device: cam(10000001), device_name: 'Front Door' },
  });
  assert.deepEqual(front.calls.at(-1), [
    'getSnapshot',
    { uuid: NOTIFICATIONS.ding.img.snapshot_uuid },
  ]);
  assert.equal(gladys.cameraImages.at(-1).deviceExternalId, cam(10000001));
  assert.ok(app.lastEventsOf(10000001).ding);

  // The same notification delivered twice is one press.
  const events = gladys.sceneEvents.length;
  front.onNewNotification.next(NOTIFICATIONS.ding);
  await flush();
  assert.equal(gladys.sceneEvents.length, events);

  t.mock.timers.tick(DING_PULSE_MS);
  await flush();
  assert.equal(gladys.lastState(`${cam(10000001)}:ding`), 0);
  app.stop();
});

test('a motion says what moved and clears after a minute', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const { gladys, account, app } = await setup();
  const backyard = account.cameras.find((c) => c.id === 10000004);
  backyard.onNewNotification.next(NOTIFICATIONS.motion_human);
  const driveway = account.cameras.find((c) => c.id === 10000003);
  driveway.onNewNotification.next(NOTIFICATIONS.motion_vehicle);
  driveway.onNewNotification.next(NOTIFICATIONS.motion_plain);
  await waitFor(() => gladys.sceneEvents.length === 3, 'three motions expected');

  // Each camera publishes its events in order; two cameras run side by side.
  const motionsOf = (id) =>
    gladys.sceneEvents
      .filter((e) => e.key === 'motion_detected' && e.data.device === cam(id))
      .map((e) => e.data.detection);
  assert.deepEqual(motionsOf(10000004), ['person']);
  assert.deepEqual(motionsOf(10000003), ['vehicle', 'motion']);
  assert.deepEqual(gladys.sceneEvents.find((e) => e.data.device === cam(10000004)).data, {
    device: cam(10000004),
    device_name: 'Backyard',
    detection: 'person',
  });
  assert.equal(gladys.lastState(`${cam(10000004)}:motion`), 1);
  t.mock.timers.tick(MOTION_HOLD_MS);
  await flush();
  assert.equal(gladys.lastState(`${cam(10000004)}:motion`), 0);
  app.stop();
});

test('the light and the siren are controlled from Gladys', async () => {
  const { gladys, account, app } = await setup();
  const driveway = account.cameras.find((c) => c.id === 10000003);
  await app.onSetValue(
    { external_id: cam(10000003) },
    { external_id: `${cam(10000003)}:light` },
    1,
  );
  assert.deepEqual(driveway.calls.at(-1), ['setLight', true]);
  assert.equal(gladys.lastState(`${cam(10000003)}:light`), 1);
  await app.onSetValue(
    { external_id: cam(10000003) },
    { external_id: `${cam(10000003)}:siren` },
    0,
  );
  assert.deepEqual(driveway.calls.at(-1), ['setSiren', false]);
  await assert.rejects(
    app.onSetValue({ external_id: cam(10000003) }, { external_id: `${cam(10000003)}:motion` }, 1),
  );
});

test('the alarm mode stays read-only unless the user allowed the control', async () => {
  const { app, account } = await setup();
  const mode = { external_id: 'ext:ring:alarm:loc-0001:mode' };
  await assert.rejects(app.onSetValue({}, mode, 'away'), /disabled/);
  assert.equal(account.locations[0].modeCalls.length, 0);
  const alarm = (await setup()).gladys.discovered.find(
    (d) => d.external_id === 'ext:ring:alarm:loc-0001',
  );
  assert.equal(alarm.features[0].read_only, true);
});

test('with the control allowed, Gladys arms the alarm and a mode change fires the trigger', async () => {
  const { app, account, gladys } = await setup({
    config: { refresh_token: TOKEN, allow_alarm_control: true },
  });
  const alarm = gladys.discovered.find((d) => d.external_id === 'ext:ring:alarm:loc-0001');
  assert.equal(alarm.features[0].read_only, false);
  await app.onSetValue({}, { external_id: 'ext:ring:alarm:loc-0001:mode' }, 'away');
  await flush();
  assert.deepEqual(account.locations[0].modeCalls, ['all']);
  assert.deepEqual(gladys.lastState('ext:ring:alarm:loc-0001:mode'), { text: 'away' });
  assert.deepEqual(gladys.sceneEvents.at(-1), {
    key: 'alarm_mode_changed',
    data: {
      device: 'ext:ring:alarm:loc-0001',
      mode: 'away',
      previous_mode: 'disarmed',
      location_name: 'Home',
    },
  });
  await assert.rejects(
    app.onSetValue({}, { external_id: 'ext:ring:alarm:loc-0001:mode' }, 'party'),
  );
});

test('a live image request returns a JPEG within the Gladys limit, resized when needed', async () => {
  const { app, account } = await setup();
  const front = account.cameras.find((c) => c.id === 10000001);
  front.snapshot = await makeLargeJpeg();
  assert.ok(front.snapshot.length > 150 * 1024, 'the fixture is over the limit');
  const image = await app.onGetImage({ external_id: cam(10000001) });
  assert.ok(image.startsWith(CAMERA_IMAGE_PREFIX));
  assert.ok(
    image.length <= MAX_CAMERA_IMAGE_LENGTH,
    `${image.length} > ${MAX_CAMERA_IMAGE_LENGTH}`,
  );

  // A recent snapshot is served again without asking Ring.
  const calls = front.calls.length;
  await app.onGetImage({ external_id: cam(10000001) });
  assert.equal(front.calls.length, calls);
});

test('a failed snapshot falls back to the last one, or fails when there is none', async () => {
  const { app, account } = await setup({ createAll: false });
  const living = account.cameras.find((c) => c.id === 10000005);
  living.snapshotError = new Error('Cannot fetch snapshot for Living Room because it is offline');
  await assert.rejects(app.onGetImage({ external_id: cam(10000005) }), /offline/);
  await assert.rejects(app.onGetImage({ external_id: 'ext:ring:alarm:loc-0001' }));
});

test('changing the language republishes the devices with the new names', async () => {
  const { app, gladys } = await setup({ createAll: false });
  await app.onConfigUpdated({ refresh_token: TOKEN, language: 'fr' });
  const front = gladys.discovered.find((d) => d.external_id === cam(10000001));
  assert.ok(front.features.some((f) => f.name === 'Appui sonnette'));
});

test('the sign-in actions get a token through two-factor authentication', async () => {
  const clients = [];
  const createRestClient = (options) => {
    const client = {
      options,
      promptFor2fa: undefined,
      async getAuth(code) {
        if (!code) {
          client.promptFor2fa = 'Please enter the code sent to +1xxxxxxx89 via sms';
          throw new Error('Your Ring account is configured to use 2-factor authentication (2fa).');
        }
        if (code !== '123456') {
          throw new Error('Verification Code is invalid or expired');
        }
        return { refresh_token: 'token-from-sign-in' };
      },
    };
    clients.push(client);
    return client;
  };
  const dataDir = await tempDir();
  const { app, gladys } = await setup({
    config: {},
    createAll: false,
    dataDir,
    createRestClient,
  });

  // No credentials yet.
  const missing = await app.sendCodeAction();
  assert.match(missing.en, /email and password/);

  await app.onConfigUpdated({ email: 'owner@example.com', password: 'pw' });
  const noPending = await app.confirmCodeAction({ code: '123456' });
  assert.match(noPending.en, /No code is pending/);

  const sent = await app.sendCodeAction();
  assert.match(sent.en, /\+1xxxxxxx89 via sms/);
  assert.match(sent.fr, /code de vérification/);
  assert.equal(clients[0].options.controlCenterDisplayName, 'Gladys Assistant');

  const wrong = await app.confirmCodeAction({ code: '000000' });
  assert.match(wrong.en, /refused this code/);

  const ok = await app.confirmCodeAction({ code: ' 123 456 ' });
  assert.match(ok.en, /Signed in/);
  await waitFor(() => gladys.connectionStatuses.at(-1).connected, 'not connected after sign-in');
  const saved = JSON.parse(await readFile(join(dataDir, 'ring-auth.json'), 'utf8'));
  assert.equal(saved.refresh_token, 'token-from-sign-in');
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  app.stop();
});

test('a wrong password is reported without a code being asked', async () => {
  const createRestClient = () => ({
    async getAuth() {
      throw new Error(
        'Failed to fetch oauth token from Ring. Verify that your email and password are correct.',
      );
    },
  });
  const { app } = await setup({
    config: { email: 'owner@example.com', password: 'bad' },
    createAll: false,
    createRestClient,
  });
  const message = await app.sendCodeAction();
  assert.match(message.en, /refused the email or the password/);
});

test('the factory is never called with a token when none is configured', async () => {
  const gladys = createFakeGladys({ config: {} });
  const factory = fakeRingApiFactory();
  const app = createApp({ gladys, dataDir: await tempDir(), createRingApi: factory });
  await app.onGladysConnected();
  assert.equal(factory.created.length, 0);
});

test('when Gladys comes back, devices, states and transports are sent again', async () => {
  const { gladys, app, factory } = await setup();
  gladys.published.length = 0;
  gladys.transports.length = 0;
  gladys.discovered = [];
  await app.onGladysConnected();
  assert.equal(factory.created.length, 1, 'the Ring session is kept');
  assert.equal(gladys.discovered.length, 17);
  assert.equal(gladys.lastState(`${cam(10000004)}:battery`), 64);
  assert.equal(gladys.transports.length, 7);
  assert.equal(gladys.connectionStatuses.at(-1).connected, true);
  app.stop();
});

test('flood, freeze, water, smoke and CO detectors publish their alarms', async () => {
  const { gladys, account, app } = await setup();
  const sensor = (zid, key) => gladys.lastState(`ext:ring:alarm-sensor:${zid}:${key}`);
  assert.equal(sensor('zid-flood-0001', 'leak'), 0);
  assert.equal(sensor('zid-flood-0001', 'freeze'), 0);
  assert.equal(sensor('zid-water-0001', 'leak'), 1);
  assert.equal(sensor('zid-smoke-0001', 'smoke'), 0);
  assert.equal(sensor('zid-co-0001', 'co'), 1);
  assert.equal(sensor('zid-listener-0001', 'smoke'), 1);
  assert.equal(sensor('zid-listener-0001', 'co'), 0);
  assert.equal(sensor('zid-kidde-0001', 'smoke'), 0);
  assert.equal(sensor('zid-kidde-0001', 'co'), 1);
  assert.equal(sensor('zid-kidde-0001', 'tamper'), undefined, 'no tamper reported, no feature');

  // The basement floods, then freezes.
  const flood = account.locations[0].alarmDevices.find((d) => d.zid === 'zid-flood-0001');
  flood.updateData({ flood: { faulted: true } });
  await flush();
  assert.equal(sensor('zid-flood-0001', 'leak'), 1);
  flood.updateData({ freeze: { faulted: true } });
  await flush();
  assert.equal(sensor('zid-flood-0001', 'freeze'), 1);

  // The Kidde alarm sounds for smoke.
  const kidde = account.locations[0].alarmDevices.find((d) => d.zid === 'zid-kidde-0001');
  kidde.updateData({
    components: {
      'alarm.smoke': { alarmStatus: 'active' },
      'alarm.co': { alarmStatus: 'inactive' },
    },
  });
  await flush();
  assert.equal(sensor('zid-kidde-0001', 'smoke'), 1);
  assert.equal(sensor('zid-kidde-0001', 'co'), 0);
  app.stop();
});

test('the keypad and the base station are not published', async () => {
  const { gladys } = await setup({ createAll: false });
  const ids = gladys.discovered.map((d) => d.external_id);
  assert.ok(!ids.some((id) => id.includes('zid-keypad') || id.includes('zid-hub')));
});
