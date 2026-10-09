// -----------------------------------------------------------------------------
// Entry point of the Ring integration for Gladys Assistant.
//
// SDK wiring only: every handler is registered before connect(), and lives in
// src/ (src/app.js for the devices, src/widgets.js, src/scenes.js).
//
// Environment provided by the Gladys supervisor: GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR (read by the SDK) and
// TZ (the Gladys time zone, used to format dates in the widget).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';
import { DATA_DIR } from './src/storage.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import {
  DOORBELL_WIDGET,
  buildDoorbellContent,
  doorbellImage,
  refreshWidgets,
  runDoorbellAction,
} from './src/widgets.js';
import { routeLibraryLogs } from './src/ring/logs.js';

const gladys = new GladysIntegration();
const app = createApp({ gladys, dataDir: DATA_DIR });
app.setWidgetChangeListener(() => refreshWidgets(gladys));
await routeLibraryLogs();

gladys.onScanRequest(() => app.onScanRequest());
gladys.onSetValue((device, feature, value) => app.onSetValue(device, feature, value));
gladys.onGetImage((device) => app.onGetImage(device));
gladys.onPoll((device) => app.onPoll(device));
gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
gladys.onConfigUpdated((config) => app.onConfigUpdated(config));

// Configuration screen actions: the two-step Ring sign-in.
gladys.onAction('send_code', () => app.sendCodeAction());
gladys.onAction('confirm_code', (fields) => app.confirmCodeAction(fields));

for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(app, { fields }));
}

gladys.onWidgetGet(DOORBELL_WIDGET, (request) => buildDoorbellContent(gladys, app, request));
gladys.onWidgetAction(DOORBELL_WIDGET, (actionKey, params) =>
  runDoorbellAction(app, { actionKey, params }),
);
gladys.onWidgetGetImage(async (imageKey) => doorbellImage(app, imageKey));

gladys.on('connected', () => {
  app.onGladysConnected().catch((err) => logger.error('Initialization failed', err));
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}, stopping`);
  app.stop();
});

logger.info('Starting the Ring integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection to Gladys failed', err);
  process.exit(1);
});
