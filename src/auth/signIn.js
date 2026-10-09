// -----------------------------------------------------------------------------
// Signing in to Ring from the Gladys Configuration screen.
//
// Ring requires two-factor authentication. Two manifest actions carry it:
//   1. `send_code` signs in with the email and password of the configuration
//      (a `secret` field works in the config form, never in an action form):
//      Ring answers "2FA required" and sends a code by SMS, email or app;
//   2. `confirm_code` sends that code (a plain string field) with the SAME
//      client — same hardware id — and gets the refresh token.
// The client waiting for its code lives in memory for 10 minutes.
// -----------------------------------------------------------------------------

const PENDING_TTL_MS = 10 * 60 * 1000;

export const SIGN_IN_MESSAGES = {
  missingCredentials: {
    en: 'Fill in the Ring email and password fields of the configuration and save first.',
    fr: "Renseignez d'abord l'e-mail et le mot de passe Ring dans la configuration, puis enregistrez.",
  },
  codeSent: (prompt) => ({
    en: `Ring sent you a verification code${prompt ? ` (${prompt})` : ''}. Enter it in "Confirm the verification code" within 10 minutes.`,
    fr: `Ring vous a envoyé un code de vérification${prompt ? ` (${prompt})` : ''}. Saisissez-le dans « Confirmer le code de vérification » sous 10 minutes.`,
  }),
  signedIn: {
    en: 'Signed in to Ring. The token is saved in the integration; you can now clear the password field.',
    fr: "Connecté à Ring. Le jeton est enregistré dans l'intégration ; vous pouvez maintenant vider le champ mot de passe.",
  },
  wrongCredentials: {
    en: 'Ring refused the email or the password.',
    fr: "Ring a refusé l'e-mail ou le mot de passe.",
  },
  tooManyCodes: {
    en: 'Ring limits verification codes to 10 every 10 minutes. Wait 10 minutes and try again.',
    fr: 'Ring limite les codes de vérification à 10 toutes les 10 minutes. Attendez 10 minutes puis réessayez.',
  },
  noPending: {
    en: 'No code is pending: run "Send a verification code" first (a code is valid 10 minutes).',
    fr: "Aucun code en attente : lancez d'abord « Envoyer un code de vérification » (un code vaut 10 minutes).",
  },
  wrongCode: {
    en: 'Ring refused this code. Check it and try again, or ask for a new one.',
    fr: 'Ring a refusé ce code. Vérifiez-le et réessayez, ou demandez-en un nouveau.',
  },
};

// A message thrown at the user: the SDK acks the action with it.
class SignInError extends Error {
  constructor(text) {
    super(text.en);
    this.text = text;
  }
}

/**
 * Turn the ring-client-api 2FA prompt into something short and free of the
 * library's wording ("sent to +1xxxxxx5678 via sms" is kept: it tells where
 * to look).
 */
function shortPrompt(prompt) {
  if (!prompt) {
    return '';
  }
  const match = /sent to (.+)$/i.exec(prompt);
  if (match) {
    return match[1];
  }
  return /authenticator/i.test(prompt) ? 'authenticator app' : '';
}

/**
 * @param {object} deps
 * @param {(options: object) => Promise<object>|object} deps.createRestClient builds a
 *   ring-client-api `RingRestClient`
 * @param {() => Promise<string>} deps.systemId stable hardware id
 * @param {() => number} [deps.now]
 */
export function createSignIn({ createRestClient, systemId, now = Date.now }) {
  let pending = null;

  return {
    SignInError,

    /**
     * @returns {Promise<{ token?: string, message: object }>} `token` when Ring
     *   signed in without asking for a code
     */
    async sendCode({ email, password }) {
      if (!email || !password) {
        throw new SignInError(SIGN_IN_MESSAGES.missingCredentials);
      }
      const client = await createRestClient({
        email,
        password,
        systemId: await systemId(),
        controlCenterDisplayName: 'Gladys Assistant',
      });
      pending = null;
      try {
        const auth = await client.getAuth();
        return { token: auth.refresh_token, message: SIGN_IN_MESSAGES.signedIn };
      } catch (err) {
        if (client.promptFor2fa) {
          pending = { client, expiresAt: now() + PENDING_TTL_MS };
          return { message: SIGN_IN_MESSAGES.codeSent(shortPrompt(client.promptFor2fa)) };
        }
        if (/too many/i.test(err?.message ?? '')) {
          throw new SignInError(SIGN_IN_MESSAGES.tooManyCodes);
        }
        throw new SignInError(SIGN_IN_MESSAGES.wrongCredentials);
      }
    },

    /** @returns {Promise<string>} the refresh token */
    async confirmCode(code) {
      const cleaned = String(code ?? '').replace(/\s+/g, '');
      if (!pending || pending.expiresAt < now()) {
        pending = null;
        throw new SignInError(SIGN_IN_MESSAGES.noPending);
      }
      try {
        const auth = await pending.client.getAuth(cleaned);
        pending = null;
        return auth.refresh_token;
      } catch {
        throw new SignInError(SIGN_IN_MESSAGES.wrongCode);
      }
    },
  };
}
