// -----------------------------------------------------------------------------
// The "Ring doorbell" dashboard widget (Gladys 5.1+).
//
// One instance shows one camera, chosen in its settings (`source: "devices"`):
// the last snapshot, the last press and the last motion with their time, the
// battery as a live tile, and the useful buttons — refresh the snapshot, the
// light on and off, the siren (with a confirmation).
//
// The core budget shapes it: at most 8 components (2 texts), 1 focal
// component (the image), 1 status list, 4 buttons. Light buttons are bound to
// the device feature, the only kind of button with a native "active" state;
// the siren is an action, so it can ask for a confirmation first.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { CAMERA_FEATURES, cameraCapabilities, cameraIds, modelName } from './devices/camera.js';

const logger = createLogger({ name: 'widgets' });

export const DOORBELL_WIDGET = 'doorbell';

// Button action keys of the content (the core drops a button whose key is
// already taken: one key per action).
export const DOORBELL_ACTIONS = {
  REFRESH: 'refresh_snapshot',
  SIREN_ON: 'siren_on',
  SIREN_OFF: 'siren_off',
};

const DETECTION_LABELS = {
  person: { en: 'Person', fr: 'Personne' },
  vehicle: { en: 'Vehicle', fr: 'Véhicule' },
  package: { en: 'Package', fr: 'Colis' },
  motion: { en: 'Motion', fr: 'Mouvement' },
};

const T = {
  chooseCamera: {
    en: 'Choose a Ring camera or doorbell in the widget settings.',
    fr: 'Choisissez une caméra ou sonnette Ring dans les réglages du widget.',
  },
  notConnected: {
    en: 'Not connected to Ring: see the integration configuration.',
    fr: "Pas connecté à Ring : voir la configuration de l'intégration.",
  },
  noSnapshot: {
    en: 'No snapshot yet: tap "Snapshot" to take one.',
    fr: "Pas encore d'instantané : touchez « Instantané » pour en prendre un.",
  },
  snapshotAlt: { en: 'Last snapshot', fr: 'Dernier instantané' },
  lastRing: { en: 'Last ring', fr: 'Dernier appui' },
  lastMotion: { en: 'Last motion', fr: 'Dernier mouvement' },
  snapshotAt: { en: 'Snapshot', fr: 'Instantané' },
  connection: { en: 'Connection', fr: 'Connexion' },
  online: { en: 'Online', fr: 'En ligne' },
  offline: { en: 'Offline', fr: 'Hors ligne' },
  never: { en: 'None yet', fr: 'Aucun pour l’instant' },
  battery: { en: 'Battery', fr: 'Batterie' },
  refresh: { en: 'Snapshot', fr: 'Instantané' },
  lightOn: { en: 'Light on', fr: 'Allumer' },
  lightOff: { en: 'Light off', fr: 'Éteindre' },
  sirenOn: { en: 'Siren', fr: 'Sirène' },
  sirenOff: { en: 'Stop siren', fr: 'Couper la sirène' },
  toastRefreshed: { en: 'Snapshot updated.', fr: 'Instantané mis à jour.' },
  toastSirenOn: { en: 'Siren sounding.', fr: 'La sirène retentit.' },
  toastSirenOff: { en: 'Siren stopped.', fr: 'Sirène coupée.' },
};

/**
 * A date as a short local text (≤ 40 characters, the bound of a status
 * value). The container runs in the Gladys time zone (`TZ`, injected by the
 * supervisor); the language picks the format, 12-hour clock for English.
 */
export function formatWhen(iso, language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const locale = language === 'fr' ? 'fr-FR' : language === 'en' ? 'en-US' : language;
  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

const textOf = (text, language) => text[language] ?? text.en;

function messageContent(text) {
  return { ttl_seconds: 60, components: [{ type: 'text', variant: 'body', text }] };
}

/**
 * The content of one widget instance.
 * @param {object} gladys SDK client
 * @param {object} app see src/app.js
 * @param {{ settings: object, language: string }} request
 */
export function buildDoorbellContent(gladys, app, { settings, language }) {
  if (!app.session) {
    return messageContent(T.notConnected);
  }
  const camera = settings?.camera ? app.cameraOf(settings.camera) : null;
  if (!camera) {
    return messageContent(T.chooseCamera);
  }
  const ids = cameraIds(gladys, camera.id);
  const data = camera.data;
  const can = cameraCapabilities(data, camera.isDoorbot);
  const snapshot = app.snapshotOf(camera.id);
  const last = app.lastEventsOf(camera.id);
  const offline = data.alerts?.connection === 'offline';
  const components = [];

  components.push({ type: 'text', variant: 'caption', text: modelName(data.kind) });
  if (snapshot) {
    components.push({ type: 'image', key: snapshot.key, alt: T.snapshotAlt, fit: 'cover' });
  } else {
    components.push({ type: 'text', variant: 'body', text: T.noSnapshot });
  }
  if (can.battery) {
    components.push({
      type: 'value',
      label: T.battery,
      icon: 'battery',
      device_feature: ids.feature(CAMERA_FEATURES.BATTERY),
    });
  }

  const items = [];
  if (can.doorbell) {
    items.push({
      label: T.lastRing,
      icon: 'bell',
      value: last.ding ? (formatWhen(last.ding.at, language) ?? T.never) : T.never,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const motion = last.motion ? formatWhen(last.motion.at, language) : null;
  items.push({
    label: T.lastMotion,
    icon: 'eye',
    value: motion
      ? `${textOf(DETECTION_LABELS[last.motion.detection] ?? DETECTION_LABELS.motion, language)} · ${motion}`
      : T.never,
    color: WIDGET_COLORS.NEUTRAL,
  });
  if (snapshot) {
    items.push({
      label: T.snapshotAt,
      icon: 'camera',
      value: formatWhen(new Date(snapshot.at).toISOString(), language),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  items.push({
    label: T.connection,
    icon: offline ? 'wifi-off' : 'wifi',
    value: offline ? T.offline : T.online,
    color: offline ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
  });
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: T.refresh,
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: DOORBELL_ACTIONS.REFRESH, params: { camera: ids.device } },
  });
  if (can.light) {
    const lightFeature = ids.feature(CAMERA_FEATURES.LIGHT);
    components.push(
      { type: 'button', label: T.lightOn, icon: 'sun', device_feature: lightFeature, value: 1 },
      { type: 'button', label: T.lightOff, icon: 'moon', device_feature: lightFeature, value: 0 },
    );
  }
  if (can.siren) {
    const sounding = app.stateOf(ids.feature(CAMERA_FEATURES.SIREN)) === 1;
    components.push(
      sounding
        ? {
            type: 'button',
            label: T.sirenOff,
            icon: 'volume-x',
            style: 'secondary',
            action: { key: DOORBELL_ACTIONS.SIREN_OFF, params: { camera: ids.device } },
          }
        : {
            type: 'button',
            label: T.sirenOn,
            icon: 'alert-triangle',
            style: 'danger',
            action: {
              key: DOORBELL_ACTIONS.SIREN_ON,
              params: { camera: ids.device },
              confirm: true,
            },
          },
    );
  }

  // Everything that changes is nudged (requestWidgetRefresh): the TTL is
  // only a safety net.
  return { ttl_seconds: 300, components };
}

/** A tapped button of the content. */
export async function runDoorbellAction(app, { actionKey, params }) {
  const camera = app.cameraOf(params?.camera ?? '');
  if (!camera) {
    throw new Error('This Ring camera is no longer available');
  }
  switch (actionKey) {
    case DOORBELL_ACTIONS.REFRESH:
      await app.refreshSnapshot(camera, { publish: true });
      return T.toastRefreshed;
    case DOORBELL_ACTIONS.SIREN_ON:
      await app.setCameraFeature(camera, CAMERA_FEATURES.SIREN, true);
      return T.toastSirenOn;
    case DOORBELL_ACTIONS.SIREN_OFF:
      await app.setCameraFeature(camera, CAMERA_FEATURES.SIREN, false);
      return T.toastSirenOff;
    default:
      throw new Error(`Unknown widget action: ${actionKey}`);
  }
}

/** Raw base64 of a snapshot key declared in a content. */
export function doorbellImage(app, imageKey) {
  const entry = app.snapshotByKey(imageKey);
  if (!entry) {
    throw new Error(`Unknown image ${imageKey}`);
  }
  return entry.buffer.toString('base64');
}

/** Ask the core to re-pull the widget (rate-limited core-side: 1 per 10 s). */
export function refreshWidgets(gladys) {
  try {
    gladys.requestWidgetRefresh(DOORBELL_WIDGET);
  } catch (err) {
    logger.debug(`Widget refresh not sent: ${err.message}`);
  }
}
