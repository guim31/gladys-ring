// -----------------------------------------------------------------------------
// Texts the container produces itself.
//
// Gladys translates what it renders from multi-language objects ({ en, fr }):
// action messages, connection status, widget contents. But a `device`
// integration never learns the user's language, and some texts are frozen as
// plain strings once published (feature names, select option labels): those
// are picked with the `language` config field.
// -----------------------------------------------------------------------------

export const TEXTS = {
  // Feature names: frozen when the user creates the device.
  featureSnapshot: { en: 'Snapshot', fr: 'Instantané' },
  featureDing: { en: 'Doorbell press', fr: 'Appui sonnette' },
  featureMotion: { en: 'Motion', fr: 'Mouvement' },
  featureBattery: { en: 'Battery', fr: 'Batterie' },
  featureLight: { en: 'Light', fr: 'Éclairage' },
  featureSiren: { en: 'Siren', fr: 'Sirène' },
  featureAlarmMode: { en: 'Alarm mode', fr: "Mode de l'alarme" },
  featureContact: { en: 'Open', fr: 'Ouvert' },
  featureTamper: { en: 'Tamper', fr: 'Sabotage' },
  featureLeak: { en: 'Leak', fr: 'Fuite' },
  featureFreeze: { en: 'Freeze', fr: 'Gel' },
  featureSmoke: { en: 'Smoke', fr: 'Fumée' },
  featureCo: { en: 'Carbon monoxide', fr: 'Monoxyde de carbone' },

  alarmDeviceName: { en: 'Ring Alarm', fr: 'Alarme Ring' },
  modeDisarmed: { en: 'Disarmed', fr: 'Désarmée' },
  modeHome: { en: 'Home', fr: 'Domicile' },
  modeAway: { en: 'Away', fr: 'Absent' },

  // Connection status (multi-language objects, rendered by Gladys).
  statusNoToken: {
    en: 'Not signed in to Ring: paste a refresh token, or use the two sign-in actions below.',
    fr: 'Pas connecté à Ring : collez un jeton de rafraîchissement, ou utilisez les deux actions de connexion ci-dessous.',
  },
  statusRevoked: {
    en: 'Ring refused the token (revoked, expired or mistyped). Sign in again: paste a new refresh token or use the sign-in actions.',
    fr: 'Ring a refusé le jeton (révoqué, expiré ou mal copié). Reconnectez-vous : collez un nouveau jeton ou utilisez les actions de connexion.',
  },
  statusUnreachable: {
    en: 'Cannot reach the Ring servers. Retrying in 5 minutes.',
    fr: 'Les serveurs Ring sont injoignables. Nouvel essai dans 5 minutes.',
  },
};

/**
 * Pick one language from a multi-language object, English as the fallback.
 * @param {{ en: string, fr?: string }} text
 * @param {string} language
 */
export function pick(text, language) {
  return text[language] ?? text.en;
}
