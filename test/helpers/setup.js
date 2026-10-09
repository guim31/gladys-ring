// Shared setup of the app tests: a fake Gladys, a fake Ring account and a
// temporary /data folder.

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../src/app.js';
import { createFakeGladys } from './fakeGladys.js';
import { fakeRingApiFactory } from './fakeRing.js';

export const TOKEN = 'test-refresh-token-not-a-real-one';

export async function tempDir() {
  return mkdtemp(join(tmpdir(), 'gladys-ring-'));
}

/**
 * @param {object} [options]
 * @param {object} [options.config] configuration served by the fake Gladys
 * @param {string} [options.behavior] 'ok' | 'auth' | 'network'
 * @param {boolean} [options.connect] run the Gladys "connected" handler
 * @param {boolean} [options.createAll] the user adds every discovered device
 */
export async function setup({
  config = { refresh_token: TOKEN },
  behavior = 'ok',
  connect = true,
  createAll = true,
  dataDir,
  createRestClient,
} = {}) {
  const gladys = createFakeGladys({ config });
  const factory = fakeRingApiFactory({ behavior });
  const dir = dataDir ?? (await tempDir());
  const app = createApp({ gladys, dataDir: dir, createRingApi: factory, createRestClient });
  const widgetChanges = [];
  app.setWidgetChangeListener(() => widgetChanges.push(Date.now()));
  if (connect) {
    await app.onGladysConnected();
  }
  if (createAll) {
    gladys.createAll();
    for (const device of gladys.devices) {
      await app.onDeviceCreated(device);
    }
  }
  return { gladys, app, factory, account: factory.account, dataDir: dir, widgetChanges };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Let the serialized subscription handlers (and their file writes) run. */
export async function flush() {
  for (let i = 0; i < 50; i += 1) {
    await tick();
  }
}

/** Wait until `predicate` holds (setImmediate-based: works with mocked timers). */
export async function waitFor(predicate, message = 'condition not met') {
  for (let i = 0; i < 5000; i += 1) {
    if (await predicate()) {
      return;
    }
    await tick();
  }
  throw new Error(message);
}
