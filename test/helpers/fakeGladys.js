// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the surface src/ relies on and records every call:
//   - externalIds(type, platformId) -> { device, feature(key) }, with the
//     `ext:<selector>:` prefix of the real SDK
//   - devices                         -> the devices the user "created"
//   - getConfig                       -> the configuration
//   - publishDiscoveredDevices, publishState(s), publishCameraImage,
//     publishTransports, setConnectionStatus, publishSceneEvent,
//     requestWidgetRefresh            -> recorded so tests can assert them
// -----------------------------------------------------------------------------

export function createFakeGladys({ selector = 'ring', config = {} } = {}) {
  const fake = {
    selector,
    config,
    devices: [],
    discovered: [],
    published: [],
    cameraImages: [],
    transports: [],
    connectionStatuses: [],
    sceneEvents: [],
    widgetRefreshes: [],

    externalId(suffix) {
      return `ext:${selector}:${suffix}`;
    },

    externalIds(type, platformId) {
      const device = `ext:${selector}:${type}:${platformId}`;
      return { device, feature: (key) => `${device}:${key}` };
    },

    async getConfig() {
      return fake.config;
    },

    async publishDiscoveredDevices(devices) {
      fake.discovered = devices;
    },

    async publishState(featureExternalId, state) {
      fake.published.push({ featureExternalId, state });
    },

    async publishCameraImage(deviceExternalId, image) {
      fake.cameraImages.push({ deviceExternalId, image });
    },

    async publishTransports(entries) {
      fake.transports.push(...entries);
    },

    async setConnectionStatus(connected, message) {
      fake.connectionStatuses.push({ connected, message });
    },

    async publishSceneEvent(key, data = {}) {
      fake.sceneEvents.push({ key, data });
      return { success: true };
    },

    requestWidgetRefresh(key) {
      fake.widgetRefreshes.push(key);
    },

    /** The user adds every discovered device in Gladys. */
    createAll() {
      fake.devices = fake.discovered.map((device) => ({ ...device }));
    },

    lastState(featureExternalId) {
      const entries = fake.published.filter((p) => p.featureExternalId === featureExternalId);
      return entries.length ? entries[entries.length - 1].state : undefined;
    },
  };
  return fake;
}
