// -----------------------------------------------------------------------------
// The Ring refresh token, persisted in /data.
//
// Ring rotates the refresh token: every authentication hands back a new one
// (ring-client-api emits it on `onRefreshTokenUpdated`, wrapped with the
// hardware id and the push notification credentials). Restarting with the
// token the user pasted weeks ago would fail, so the latest one is saved here
// and preferred, as long as the user has not pasted a different token in the
// configuration since: the file remembers a hash of the token it started from
// (`seed`), never the pasted token itself.
// -----------------------------------------------------------------------------

import { createHash, randomUUID } from 'node:crypto';
import { readJson, writeJson } from '../storage.js';

const FILE = 'ring-auth.json';

// Seed of a token obtained through the sign-in actions (no pasted token).
export const SIGN_IN_SEED = 'sign-in';

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function createTokenStore(dir) {
  async function load() {
    return (await readJson(dir, FILE)) ?? {};
  }

  async function save(patch) {
    const next = { ...(await load()), ...patch, updated_at: new Date().toISOString() };
    await writeJson(dir, FILE, next);
    return next;
  }

  return {
    /**
     * A stable id for this installation, sent to Ring as the hardware id: the
     * container has no machine id of its own, and a random one at every start
     * would add a new "authorized device" to the Ring account each time.
     */
    async systemId() {
      const state = await load();
      if (state.system_id) {
        return state.system_id;
      }
      const systemId = randomUUID();
      await save({ system_id: systemId });
      return systemId;
    },

    /**
     * The token to start with.
     * @param {string} configToken the token pasted in the configuration ('' if none)
     * @returns {Promise<{ token: string|null }>}
     */
    async resolve(configToken) {
      const state = await load();
      // Signed in through the actions while this very config was saved: the
      // sign-in is the newer intent, even with an older token still pasted.
      if (
        state.seed === SIGN_IN_SEED &&
        state.refresh_token &&
        state.config_seed === hashToken(configToken ?? '')
      ) {
        return { token: state.refresh_token };
      }
      if (configToken) {
        const seed = hashToken(configToken);
        if (state.seed === seed && state.refresh_token) {
          return { token: state.refresh_token };
        }
        // A token the user just pasted: it replaces whatever was saved.
        await save({ seed, refresh_token: configToken });
        return { token: configToken };
      }
      return { token: null };
    },

    /** Ring handed back a new token: keep it for the next start. */
    async rotate(token) {
      await save({ refresh_token: token });
    },

    /**
     * A token obtained through the sign-in actions.
     * @param {string} token
     * @param {string} configToken the token pasted in the configuration at that time
     */
    async signedIn(token, configToken) {
      await save({
        seed: SIGN_IN_SEED,
        config_seed: hashToken(configToken ?? ''),
        refresh_token: token,
      });
    },

    load,
  };
}
