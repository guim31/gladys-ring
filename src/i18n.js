// -----------------------------------------------------------------------------
// Texts the container produces itself.
//
// Gladys translates what it renders from multi-language objects
// ({ en, fr, de, es }):
// action messages, connection status, widget contents. But a `device`
// integration never learns the user's language, and some texts are frozen as
// plain strings once published (feature names, select option labels): those
// are picked with the `language` config field.
// -----------------------------------------------------------------------------

export const TEXTS = {
  // Feature names: frozen when the user creates the device.
  featureSnapshot: { en: 'Snapshot', fr: 'Instantané', de: 'Schnappschuss', es: 'Instantánea' },
  featureDing: {
    en: 'Doorbell press',
    fr: 'Appui sonnette',
    de: 'Klingeln',
    es: 'Pulsación del timbre',
  },
  featureMotion: { en: 'Motion', fr: 'Mouvement', de: 'Bewegung', es: 'Movimiento' },
  featureBattery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  featureLight: { en: 'Light', fr: 'Éclairage', de: 'Licht', es: 'Luz' },
  featureSiren: { en: 'Siren', fr: 'Sirène', de: 'Sirene', es: 'Sirena' },
  featureAlarmMode: {
    en: 'Alarm mode',
    fr: "Mode de l'alarme",
    de: 'Alarmmodus',
    es: 'Modo de la alarma',
  },
  featureContact: { en: 'Opening', fr: 'Ouverture', de: 'Öffnung', es: 'Apertura' },
  featureTamper: { en: 'Tamper', fr: 'Sabotage', de: 'Manipulation', es: 'Manipulación' },
  featureLeak: { en: 'Leak', fr: 'Fuite', de: 'Wasserleck', es: 'Fuga de agua' },
  featureFreeze: { en: 'Freeze', fr: 'Gel', de: 'Frost', es: 'Helada' },
  featureSmoke: { en: 'Smoke', fr: 'Fumée', de: 'Rauch', es: 'Humo' },
  featureCo: {
    en: 'Carbon monoxide',
    fr: 'Monoxyde de carbone',
    de: 'Kohlenmonoxid',
    es: 'Monóxido de carbono',
  },

  alarmDeviceName: { en: 'Ring Alarm', fr: 'Alarme Ring', de: 'Ring Alarm', es: 'Alarma Ring' },
  modeDisarmed: { en: 'Disarmed', fr: 'Désarmée', de: 'Unscharf', es: 'Desarmada' },
  modeHome: { en: 'Home', fr: 'Domicile', de: 'Zuhause', es: 'En casa' },
  modeAway: { en: 'Away', fr: 'Absent', de: 'Abwesend', es: 'Ausente' },

  // Connection status (multi-language objects, rendered by Gladys).
  statusNoToken: {
    en: 'Not signed in to Ring: paste a refresh token, or use the two sign-in actions below.',
    fr: 'Pas connecté à Ring : collez un jeton de rafraîchissement, ou utilisez les deux actions de connexion ci-dessous.',
    de: 'Nicht bei Ring angemeldet: Füge ein Refresh-Token ein oder nutze die beiden Anmeldeaktionen unten.',
    es: 'Sin sesión en Ring: pegue un token de actualización o utilice las dos acciones de inicio de sesión de abajo.',
  },
  statusRevoked: {
    en: 'Ring refused the token (revoked, expired or mistyped). Sign in again: paste a new refresh token or use the sign-in actions.',
    fr: 'Ring a refusé le jeton (révoqué, expiré ou mal copié). Reconnectez-vous : collez un nouveau jeton ou utilisez les actions de connexion.',
    de: 'Ring hat das Token abgelehnt (widerrufen, abgelaufen oder falsch kopiert). Melde dich erneut an: Füge ein neues Refresh-Token ein oder nutze die Anmeldeaktionen.',
    es: 'Ring ha rechazado el token (revocado, caducado o mal copiado). Vuelva a iniciar sesión: pegue un nuevo token de actualización o utilice las acciones de inicio de sesión.',
  },
  statusUnreachable: {
    en: 'Cannot reach the Ring servers. Retrying in 5 minutes.',
    fr: 'Les serveurs Ring sont injoignables. Nouvel essai dans 5 minutes.',
    de: 'Die Ring-Server sind nicht erreichbar. Neuer Versuch in 5 Minuten.',
    es: 'No se puede acceder a los servidores de Ring. Nuevo intento en 5 minutos.',
  },
};

/**
 * Pick one language from a multi-language object, English as the fallback.
 * @param {{ en: string, fr?: string, de?: string, es?: string }} text
 * @param {string} language
 */
export function pick(text, language) {
  return text[language] ?? text.en;
}
