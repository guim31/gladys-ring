// -----------------------------------------------------------------------------
// ring-client-api logs, routed to the integration logger.
//
// The library logs through the `debug` package (silent by default), so its
// errors — a failed push registration, a refused request — would never reach
// the Gladys log screen. They are routed here, with anything shaped like a
// token or a key redacted first: some library messages quote request or
// response bodies, and the logs are shown in the Gladys UI.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'ring-client-api' });

// The library repeats its errors at every retry (a lost push connection, a
// failing refresh every 60 s): the same message is a warning once an hour.
const REPEAT_WINDOW_MS = 60 * 60_000;
const MAX_REMEMBERED = 100;

/** Mask long opaque strings (tokens, keys, push credentials). */
export function redact(message) {
  let text;
  if (typeof message === 'string') {
    text = message;
  } else if (message instanceof Error) {
    text = message.message;
  } else {
    try {
      text = JSON.stringify(message);
    } catch {
      text = String(message);
    }
  }
  return String(text).replace(/[A-Za-z0-9+/_=.-]{32,}/g, '[redacted]');
}

/** A `logError` for the library: each distinct message warns once per hour. */
export function createErrorLogger(target = logger, now = Date.now) {
  const lastWarned = new Map();
  return (message) => {
    const text = redact(message);
    const at = lastWarned.get(text);
    if (at !== undefined && now() - at < REPEAT_WINDOW_MS) {
      target.debug(text);
      return;
    }
    if (lastWarned.size >= MAX_REMEMBERED) {
      lastWarned.clear();
    }
    lastWarned.set(text, now());
    target.warn(text);
  };
}

export async function routeLibraryLogs() {
  const { useLogger } = await import('ring-client-api/util');
  useLogger({
    logInfo: (...messages) => logger.debug(messages.map(redact).join(' ')),
    logError: createErrorLogger(),
  });
}
