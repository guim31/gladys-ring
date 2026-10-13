// Gladys 5.2.0 polls a device only when it has should_poll: true AND a valid
// poll_frequency, and never updates those fields on devices already created
// (GladysAssistant/Gladys#3198). This integration never relies on onPoll: the
// states are pushed from the container. And a normal cycle stays silent at the
// info level, repeated failures being logged once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RETRY_UNREACHABLE_MS } from '../src/app.js';
import { createIssueLog } from '../src/issues.js';
import { createErrorLogger } from '../src/ring/logs.js';
import { NOTIFICATIONS } from './helpers/fakeRing.js';
import { TOKEN, flush, setup, waitFor } from './helpers/setup.js';

const cam = (id) => `ext:ring:camera:${id}`;

/** Capture the SDK logger output (console.log for debug/info, console.error for warn/error). */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => lines.push(args.join(' ')));
  return {
    lines,
    at: (level) => lines.filter((line) => line.includes(`[${level}]`)),
    clear: () => {
      lines.length = 0;
    },
  };
}

function recordingLogger() {
  const lines = [];
  const log = (level) => (message) => lines.push({ level, message });
  return {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
}

test('states reach Gladys without onPoll: no device asks to be polled', async () => {
  const { gladys, app, account } = await setup();
  for (const device of gladys.discovered) {
    assert.equal(device.should_poll, false, `${device.external_id} must not depend on onPoll`);
  }
  // The library refreshes the camera status every 60 s by itself: the change
  // reaches Gladys with no onPoll call at all.
  const camera = account.cameras.find((c) => c.id === 10000004);
  camera.updateData({ ...camera.data, battery_life: 42 });
  await flush();
  assert.equal(gladys.lastState(`${cam(10000004)}:battery`), 42);

  // The onPoll fallback stays harmless: it only re-sends the known states.
  const before = gladys.published.length;
  await app.onPoll({ external_id: cam(10000004) });
  assert.ok(gladys.published.length > before);
  assert.equal(gladys.lastState(`${cam(10000004)}:battery`), 42);
  app.stop();
});

test('a normal cycle writes nothing at the info level', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const logs = captureLogs(t);
  const { gladys, app, account } = await setup();
  assert.ok(logs.at('INFO').some((line) => line.includes('Connected to Ring')));
  logs.clear();

  // Status refreshes, a sensor change, a motion, the periodic snapshots.
  for (const camera of account.cameras) {
    camera.updateData({ ...camera.data });
  }
  const camera = account.cameras.find((c) => c.id === 10000004);
  camera.updateData({ ...camera.data, battery_life: 40 });
  const sensor = account.locations[0].alarmDevices.find((d) => d.zid === 'zid-contact-0001');
  sensor.updateData({ faulted: true });
  camera.onNewNotification.next(NOTIFICATIONS.motion_human);
  await waitFor(() => gladys.sceneEvents.length === 1, 'motion expected');
  const images = gladys.cameraImages.length;
  t.mock.timers.tick(30 * 60_000);
  await waitFor(() => gladys.cameraImages.length > images + 3, 'periodic snapshots expected');
  await flush();

  assert.deepEqual(logs.at('INFO'), []);
  assert.deepEqual(logs.at('WARN'), []);
  assert.deepEqual(logs.at('ERROR'), []);
  app.stop();
});

test('an unreachable Ring is logged once, then once again when it is back', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const logs = captureLogs(t);
  const { app, factory } = await setup({ behavior: 'network', createAll: false });
  for (let i = 0; i < 3; i += 1) {
    t.mock.timers.tick(RETRY_UNREACHABLE_MS);
    await waitFor(() => factory.created.length === i + 2, 'retry expected');
    await flush();
  }
  assert.equal(app.status, 'unreachable');
  assert.equal(logs.at('WARN').filter((line) => line.includes('Ring unreachable')).length, 1);

  factory.behavior = 'ok';
  t.mock.timers.tick(RETRY_UNREACHABLE_MS);
  await waitFor(() => app.status === 'connected', 'reconnection expected');
  assert.equal(logs.at('INFO').filter((line) => line.includes('Connected to Ring')).length, 1);
  assert.ok(!logs.lines.some((line) => line.includes(TOKEN)), 'the token is never logged');
  app.stop();
});

test('states refused while Gladys restarts are reported once', async (t) => {
  const logs = captureLogs(t);
  const { gladys, app, account } = await setup();
  logs.clear();
  const publishState = gladys.publishState;
  gladys.publishState = async () => {
    throw new Error('Gladys is restarting');
  };
  const camera = account.cameras.find((c) => c.id === 10000004);
  for (const battery of [30, 31, 32]) {
    camera.updateData({ ...camera.data, battery_life: battery });
    await flush();
  }
  assert.equal(logs.at('WARN').length, 1);

  gladys.publishState = publishState;
  camera.updateData({ ...camera.data, battery_life: 33 });
  await flush();
  assert.deepEqual(
    logs.at('INFO').map((line) => line.replace(/^.*\] /, '')),
    ['States published again'],
  );
  app.stop();
});

test('the issue log reports a failure once and its recovery once', () => {
  const logger = recordingLogger();
  const issues = createIssueLog(logger);
  issues.recover('a', 'nothing to recover');
  issues.fail('a', 'down');
  issues.fail('a', 'still down');
  issues.fail('b', 'refused', 'error');
  issues.recover('a', 'back');
  issues.recover('a', 'back');
  assert.deepEqual(logger.lines, [
    { level: 'warn', message: 'down' },
    { level: 'debug', message: 'still down' },
    { level: 'error', message: 'refused' },
    { level: 'info', message: 'back' },
  ]);
});

test('a repeated library error warns once an hour, redacted', () => {
  const logger = recordingLogger();
  let clock = 0;
  const logError = createErrorLogger(logger, () => clock);
  const secret = 'a'.repeat(40);
  logError(`push failed ${secret}`);
  clock += 60_000;
  logError(`push failed ${secret}`);
  clock += 60 * 60_000;
  logError(`push failed ${secret}`);
  assert.deepEqual(
    logger.lines.map((l) => l.level),
    ['warn', 'debug', 'warn'],
  );
  assert.ok(logger.lines.every((l) => !l.message.includes(secret)));
});
