// -----------------------------------------------------------------------------
// Fake ring-client-api objects, built from the recorded API data of
// test/fixtures/ring/. They expose the surface src/ reads: RingApi
// (getLocations, onRefreshTokenUpdated, disconnect), Location (cameras,
// hasAlarmBaseStation, getDevices, setAlarmMode), RingCamera (data, onData,
// onNewNotification, isDoorbot, setLight, setSiren, getSnapshot) and
// RingDevice (zid, data, onData). Observables are reduced to what rxjs
// subjects do for us: subscribe() -> { unsubscribe() }.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/ring/${name}`, import.meta.url), 'utf8'));

export const RING_DEVICES = fixture('ring-devices.json');
export const LOCATIONS = fixture('locations.json').user_locations;
export const ALARM_DEVICES = fixture('alarm-devices.json').devices;
export const NOTIFICATIONS = fixture('notifications.json');

export class Subject {
  constructor() {
    this.observers = new Set();
  }
  subscribe(fn) {
    this.observers.add(fn);
    return { unsubscribe: () => this.observers.delete(fn) };
  }
  next(value) {
    for (const fn of [...this.observers]) {
      fn(value);
    }
  }
}

export class BehaviorSubject extends Subject {
  constructor(value) {
    super();
    this.value = value;
  }
  subscribe(fn) {
    const subscription = super.subscribe(fn);
    fn(this.value);
    return subscription;
  }
  next(value) {
    this.value = value;
    super.next(value);
  }
}

/** A real, small JPEG, as Ring would send a snapshot. */
export const SMALL_JPEG = await sharp({
  create: { width: 64, height: 36, channels: 3, background: { r: 40, g: 120, b: 200 } },
})
  .jpeg({ quality: 80 })
  .toBuffer();

/** A large noisy 1080p JPEG, over the Gladys 150 KB camera limit. */
export async function makeLargeJpeg(width = 1920, height = 1080) {
  const data = Buffer.alloc(width * height * 3);
  let seed = 42;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed & 0xff;
  }
  return sharp(data, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

export class FakeCamera {
  constructor(data, isDoorbot) {
    this.id = data.id;
    this.data = data;
    this.isDoorbot = isDoorbot;
    this.onData = new BehaviorSubject(data);
    this.onNewNotification = new Subject();
    this.calls = [];
    this.snapshot = SMALL_JPEG;
    this.snapshotError = null;
  }
  get name() {
    return this.data.description;
  }
  updateData(data) {
    this.data = data;
    this.onData.next(data);
  }
  async setLight(on) {
    this.calls.push(['setLight', on]);
    this.updateData({ ...this.data, led_status: on ? 'on' : 'off' });
  }
  async setSiren(on) {
    this.calls.push(['setSiren', on]);
    this.updateData({ ...this.data, siren_status: { seconds_remaining: on ? 1 : 0 } });
  }
  async getSnapshot(options) {
    this.calls.push(['getSnapshot', options]);
    if (this.snapshotError) {
      throw this.snapshotError;
    }
    return this.snapshot;
  }
}

export class FakeRingDevice {
  constructor(data) {
    this.zid = data.zid;
    this.data = data;
    this.onData = new BehaviorSubject(data);
  }
  updateData(patch) {
    this.data = { ...this.data, ...patch };
    this.onData.next(this.data);
  }
}

export class FakeLocation {
  constructor(details, cameras, alarmDevices) {
    this.locationDetails = details;
    this.id = details.location_id;
    this.name = details.name;
    this.cameras = cameras;
    this.alarmDevices = alarmDevices;
    this.hasAlarmBaseStation = alarmDevices.length > 0;
    this.modeCalls = [];
  }
  async getDevices() {
    return this.alarmDevices;
  }
  async setAlarmMode(mode) {
    this.modeCalls.push(mode);
    const panel = this.alarmDevices.find((d) => d.data.deviceType === 'security-panel');
    panel.updateData({ mode });
  }
}

/**
 * Build the fake account: the cameras of ring-devices.json split by location,
 * the alarm devices on loc-0001 (the location with a base station).
 */
export function buildFakeAccount() {
  const doorbotIds = new Set(
    [...RING_DEVICES.doorbots, ...RING_DEVICES.authorized_doorbots].map((d) => d.id),
  );
  const allCameras = [
    ...RING_DEVICES.doorbots,
    ...RING_DEVICES.stickup_cams,
    ...RING_DEVICES.authorized_doorbots,
  ].map(
    // ring-client-api's rule for isDoorbot (api.ts, fetchAndBuildLocations).
    (data) =>
      new FakeCamera(
        structuredClone(data),
        doorbotIds.has(data.id) || data.kind.startsWith('doorbell'),
      ),
  );
  const baseStationLocations = new Set(RING_DEVICES.base_stations.map((b) => b.location_id));
  const locations = LOCATIONS.map(
    (details) =>
      new FakeLocation(
        details,
        allCameras.filter((camera) => camera.data.location_id === details.location_id),
        baseStationLocations.has(details.location_id)
          ? ALARM_DEVICES.map((data) => new FakeRingDevice(structuredClone(data)))
          : [],
      ),
  );
  return { locations, cameras: allCameras };
}

/**
 * A createRingApi factory for createApp. `behavior` can make the sign-in
 * fail: 'auth' (token refused), 'network' (no answer).
 */
export function fakeRingApiFactory({ account = buildFakeAccount(), behavior = 'ok' } = {}) {
  const created = [];
  const factory = (options) => {
    const api = {
      options,
      onRefreshTokenUpdated: new Subject(),
      disconnected: false,
      async getLocations() {
        if (behavior === 'auth') {
          throw new Error(
            'Refresh token is not valid.  Unable to authenticate with Ring servers.  See https://github.com/dgreif/ring/wiki/Refresh-Tokens',
          );
        }
        if (behavior === 'network') {
          throw new Error('fetch failed');
        }
        return account.locations;
      },
      disconnect() {
        this.disconnected = true;
      },
    };
    created.push(api);
    return api;
  };
  factory.created = created;
  factory.account = account;
  return factory;
}
