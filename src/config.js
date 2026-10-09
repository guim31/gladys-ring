// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the manifest `config_schema`; the SDK
// fetches it (`gladys.getConfig()`) and notifies every change
// (`gladys.onConfigUpdated()`). This module only applies the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with a value typed as a string by a form.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr'];

// Allowed values of the `snapshot_interval` select, in minutes. 0 = only after
// a ring, a motion or an explicit request. Ring battery cameras never refresh
// their picture more than once every 10 minutes when asked (see
// src/ring/session.js), so nothing shorter is offered.
export const SNAPSHOT_INTERVALS = [0, 10, 30, 60];

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  refresh_token: '',
  email: '',
  password: '',
  language: 'en',
  snapshot_interval: '30',
  allow_alarm_control: false,
};

/**
 * A refresh token pasted from `ring-auth-cli` often comes with what surrounds
 * it in the CLI output (`"refreshToken": "..."`): keep the token alone.
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanRefreshToken(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  let token = raw.trim();
  token = token.replace(/^"?refreshToken"?\s*:\s*/i, '');
  token = token.replace(/^["']+|["',]+$/g, '');
  return token.trim();
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...raw };
  const interval = Number(config.snapshot_interval);
  return {
    ...config,
    refresh_token: cleanRefreshToken(config.refresh_token),
    email: typeof config.email === 'string' ? config.email.trim() : '',
    password: typeof config.password === 'string' ? config.password : '',
    language: LANGUAGES.includes(config.language) ? config.language : DEFAULT_CONFIG.language,
    snapshotIntervalMinutes: SNAPSHOT_INTERVALS.includes(interval)
      ? interval
      : Number(DEFAULT_CONFIG.snapshot_interval),
    // Only an explicit true unlocks the alarm: a missing value keeps it read-only.
    allow_alarm_control:
      config.allow_alarm_control === true || config.allow_alarm_control === 'true',
  };
}
