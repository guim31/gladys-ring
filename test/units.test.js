// Unit tests of the small pure modules: configuration, token store, events,
// image fitting, log redaction, device capabilities.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { DEFAULT_CONFIG, cleanRefreshToken, normalizeConfig } from '../src/config.js';
import { createTokenStore, hashToken } from '../src/auth/tokenStore.js';
import { createEventLog, detectionOf, parseNotification } from '../src/events.js';
import { fitJpeg, fitsCameraImage } from '../src/image.js';
import { redact } from '../src/ring/logs.js';
import { isAuthError } from '../src/ring/session.js';
import { batteryLevel, cameraCapabilities, modelName } from '../src/devices/camera.js';
import { modeFromRing } from '../src/devices/alarm.js';
import { NOTIFICATIONS, RING_DEVICES, SMALL_JPEG, makeLargeJpeg } from './helpers/fakeRing.js';
import { tempDir } from './helpers/setup.js';

test('normalizeConfig applies the defaults and coerces the form values', () => {
  const config = normalizeConfig();
  assert.equal(config.language, 'en');
  assert.equal(config.snapshotIntervalMinutes, 30);
  assert.equal(config.allow_alarm_control, false);
  const custom = normalizeConfig({
    language: 'fr',
    snapshot_interval: '0',
    allow_alarm_control: 'true',
  });
  assert.equal(custom.language, 'fr');
  assert.equal(custom.snapshotIntervalMinutes, 0);
  assert.equal(custom.allow_alarm_control, true);
  const odd = normalizeConfig({
    language: 'xx',
    snapshot_interval: '7',
    allow_alarm_control: 'yes',
  });
  assert.equal(odd.language, 'en');
  assert.equal(odd.snapshotIntervalMinutes, 30);
  assert.equal(odd.allow_alarm_control, false, 'only an explicit true unlocks the alarm');
  assert.equal(DEFAULT_CONFIG.snapshot_interval, '30');
});

test('a token pasted with its ring-auth-cli surroundings is cleaned', () => {
  assert.equal(cleanRefreshToken('  "refreshToken": "abc123=="  '), 'abc123==');
  assert.equal(cleanRefreshToken('"abc123",'), 'abc123');
  assert.equal(cleanRefreshToken('abc123'), 'abc123');
  assert.equal(cleanRefreshToken(undefined), '');
});

test('the token store prefers the rotated token, until another one is pasted', async () => {
  const dir = await tempDir();
  const store = createTokenStore(dir);
  assert.deepEqual(await store.resolve(''), { token: null });
  assert.deepEqual(await store.resolve('pasted-1'), { token: 'pasted-1' });
  await store.rotate('rotated-1');
  assert.deepEqual(await store.resolve('pasted-1'), { token: 'rotated-1' });
  assert.deepEqual(await store.resolve('pasted-2'), { token: 'pasted-2' });

  // Sign-in with the actions wins over the token pasted at that time...
  await store.signedIn('signed-in', 'pasted-2');
  assert.deepEqual(await store.resolve('pasted-2'), { token: 'signed-in' });
  // ...until the user pastes another one.
  assert.deepEqual(await store.resolve('pasted-3'), { token: 'pasted-3' });

  const file = join(dir, 'ring-auth.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.seed, hashToken('pasted-3'));
  assert.equal((await stat(file)).mode & 0o777, 0o600, 'the token file is private');

  const id = await store.systemId();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(await store.systemId(), id, 'the hardware id is stable');
});

test('push notifications are parsed into presses and motions', () => {
  assert.deepEqual(parseNotification(NOTIFICATIONS.ding), {
    kind: 'ding',
    id: '7300000000000000001',
    at: '2026-10-09T18:32:00Z',
    snapshotUuid: NOTIFICATIONS.ding.img.snapshot_uuid,
  });
  assert.equal(parseNotification(NOTIFICATIONS.motion_human).detection, 'person');
  assert.equal(detectionOf(NOTIFICATIONS.motion_vehicle), 'vehicle');
  assert.equal(detectionOf(NOTIFICATIONS.motion_plain), 'motion');
  assert.equal(parseNotification(NOTIFICATIONS.motion_plain).snapshotUuid, undefined);
  assert.equal(parseNotification({ android_config: { category: 'other' }, data: {} }), null);
  const pkg = structuredClone(NOTIFICATIONS.motion_human);
  pkg.data.event.ding.detection_type = 'package_delivery';
  assert.equal(detectionOf(pkg), 'package');
});

test('the event log survives a restart and ignores duplicates', async () => {
  const dir = await tempDir();
  const log = createEventLog(dir);
  await log.load();
  const event = parseNotification(NOTIFICATIONS.motion_human);
  assert.equal(await log.record('10000004', event), true);
  assert.equal(await log.record('10000004', event), false);
  const again = createEventLog(dir);
  await again.load();
  assert.deepEqual(again.lastOf('10000004'), {
    motion: { at: '2026-10-09T18:32:00Z', detection: 'person' },
  });
});

test('fitJpeg keeps small images and shrinks large ones under the limit', async () => {
  assert.equal(await fitJpeg(SMALL_JPEG), SMALL_JPEG);
  const large = await makeLargeJpeg();
  assert.equal(fitsCameraImage(large), false);
  const fitted = await fitJpeg(large);
  assert.equal(fitsCameraImage(fitted), true);
  const { width, height, format } = await sharp(fitted).metadata();
  assert.equal(format, 'jpeg');
  assert.ok(width <= 1280 && Math.abs(width / height - 16 / 9) < 0.02, `${width}x${height}`);
});

test('log redaction masks anything shaped like a token', () => {
  const token = 'eyJydCI6IjEyMzQ1Njc4OTAiLCJoaWQiOiJhYmNkZWYifQ==abcdefghij';
  assert.equal(redact(`refresh failed for ${token}`), 'refresh failed for [redacted]');
  assert.equal(redact(new Error('plain message')), 'plain message');
  assert.match(redact({ token }), /\[redacted\]/);
});

test('ring-client-api refusals are told apart from network errors', () => {
  assert.equal(isAuthError(new Error('Refresh token is not valid.  Unable to authenticate')), true);
  assert.equal(isAuthError(new Error('Failed to fetch oauth token from Ring.')), true);
  assert.equal(isAuthError(new Error('fetch failed')), false);
});

test('camera capabilities come from the device data', () => {
  const [pro, battery] = RING_DEVICES.doorbots;
  assert.equal(batteryLevel(pro), null, 'Doorbell Pro: 4081 is not a percentage');
  assert.equal(batteryLevel(battery), 87, 'string battery level');
  const [flood, spotlight, indoor] = RING_DEVICES.stickup_cams;
  assert.deepEqual(cameraCapabilities(flood, false), {
    doorbell: false,
    battery: false,
    light: true,
    siren: true,
  });
  assert.equal(batteryLevel(spotlight), 64, 'the lowest pack of two');
  assert.deepEqual(cameraCapabilities(indoor, false), {
    doorbell: false,
    battery: false,
    light: false,
    siren: false,
  });
  assert.equal(modelName('lpd_v1'), 'Ring Video Doorbell Pro');
  assert.equal(modelName('future_kind'), 'Ring Camera');
  assert.equal(modeFromRing('some'), 'home');
  assert.equal(modeFromRing('weird'), null);
});
