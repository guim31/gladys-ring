// -----------------------------------------------------------------------------
// Repeated failures, logged once.
//
// A failure that repeats (Ring unreachable for an hour, Gladys restarting while
// states are sent) would otherwise write the same line at every attempt. The
// first failure of a kind is logged at its level, the next ones at debug, and
// the recovery once, at info.
// -----------------------------------------------------------------------------

export function createIssueLog(logger) {
  const open = new Set();

  return {
    /**
     * @param {string} key kind of failure (one open issue per key)
     * @param {string} message
     * @param {'warn'|'error'} [level]
     */
    fail(key, message, level = 'warn') {
      if (open.has(key)) {
        logger.debug(message);
        return;
      }
      open.add(key);
      logger[level](message);
    },

    /** The failure of this kind is over: say it once, if it was reported. */
    recover(key, message) {
      if (open.delete(key) && message) {
        logger.info(message);
      }
    },

    has(key) {
      return open.has(key);
    },
  };
}
