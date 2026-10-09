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

export async function routeLibraryLogs() {
  const { useLogger } = await import('ring-client-api/util');
  useLogger({
    logInfo: (...messages) => logger.debug(messages.map(redact).join(' ')),
    logError: (message) => logger.warn(redact(message)),
  });
}
