// -----------------------------------------------------------------------------
// Conformity of every discovered device with the rules of the Gladys core.
//
// test/fixtures/gladys-feature-table.json is taken from the code of the core
// (server/utils/constants.js, front/src/utils/consts.js, front i18n): a
// category/type couple missing there shows as "undefined" or without icon,
// a poll frequency outside its list is refused (400), a feature without
// min/max cannot be added (422). Every device is built from the recorded Ring
// data of test/fixtures/ring/ (doorbells wired and on battery, shared
// doorbell, Floodlight, Spotlight, Indoor cam offline, Ring Alarm and its
// sensors). Do not edit this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCameraDevice } from '../src/devices/camera.js';
import { buildAlarmDevice, buildSensorDevice, isSupportedSensor } from '../src/devices/alarm.js';
import { buildFakeAccount } from './helpers/fakeRing.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const table = JSON.parse(
  readFileSync(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

function allDevices() {
  const gladys = createFakeGladys();
  const account = buildFakeAccount();
  const devices = [];
  for (const language of ['en', 'fr']) {
    for (const camera of account.cameras) {
      devices.push(
        buildCameraDevice(gladys, { data: camera.data, isDoorbot: camera.isDoorbot }, language),
      );
    }
    for (const location of account.locations) {
      if (location.hasAlarmBaseStation) {
        for (const allowControl of [true, false]) {
          devices.push(
            buildAlarmDevice(
              gladys,
              { locationId: location.id, locationName: location.name },
              { language, allowControl },
            ),
          );
        }
      }
      for (const device of location.alarmDevices) {
        if (isSupportedSensor(device.data)) {
          devices.push(buildSensorDevice(gladys, device.data, language));
        }
      }
    }
  }
  return devices;
}

const devices = allDevices();

test('the fixtures cover several models', () => {
  // 7 cameras, 1 alarm (x2 control modes), 9 sensors (contact x2, motion,
  // flood/freeze, water, smoke, CO, smoke/CO listener, Kidde), in 2 languages.
  assert.equal(devices.length, (7 + 2 + 9) * 2);
});

for (const device of devices) {
  test(`${device.name} (${device.model}) follows the rules of the Gladys core`, () => {
    assert.ok(device.external_id.startsWith('ext:'), 'external_id built with gladys.externalIds');

    // Polling: should_poll true if and only if poll_frequency is given, in ms.
    if (device.poll_frequency !== undefined) {
      assert.equal(
        device.should_poll,
        true,
        'poll_frequency without should_poll: true is never polled',
      );
      assert.ok(
        table.poll_frequencies_ms.includes(device.poll_frequency),
        `poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
      );
    } else {
      assert.notEqual(device.should_poll, true, 'should_poll: true needs a poll_frequency');
    }

    const ids = new Set();
    const names = new Set();
    assert.ok(device.features.length > 0);
    for (const feature of device.features) {
      const pair = `${feature.category}/${feature.type}`;
      const entry = table.pairs[pair];
      assert.ok(entry, `${pair} is not a category/type couple of the core`);
      assert.ok(entry.label_en && entry.label_fr, `${pair} has labels`);
      assert.ok(entry.icon, `${pair} has an icon`);

      assert.equal(typeof feature.min, 'number', `${feature.name}: min must be a number`);
      assert.equal(typeof feature.max, 'number', `${feature.name}: max must be a number`);
      assert.ok(feature.min <= feature.max, `${feature.name}: min <= max`);
      assert.equal(typeof feature.read_only, 'boolean', `${feature.name}: read_only`);
      assert.equal(typeof feature.has_feedback, 'boolean', `${feature.name}: has_feedback`);
      if (feature.unit !== undefined) {
        assert.ok(
          table.units.includes(feature.unit),
          `${feature.name}: unknown unit ${feature.unit}`,
        );
        const allowed = table.units_by_category[feature.category];
        if (allowed) {
          assert.ok(
            allowed.includes(feature.unit),
            `${feature.unit} is not a ${feature.category} unit`,
          );
        }
      }

      assert.ok(
        feature.external_id.startsWith(`${device.external_id}:`),
        'feature id under the device id',
      );
      assert.ok(
        !ids.has(feature.external_id),
        `duplicate feature external_id ${feature.external_id}`,
      );
      ids.add(feature.external_id);
      assert.ok(!names.has(feature.name), `duplicate feature name "${feature.name}"`);
      names.add(feature.name);

      for (const option of feature.supported_options ?? []) {
        assert.ok(option.label, 'every supported option has a label');
        if (typeof option.value === 'string') {
          assert.equal(
            pair,
            'text/select',
            'string option values are only accepted on text/select',
          );
        }
      }
    }
  });
}
