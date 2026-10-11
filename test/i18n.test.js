// -----------------------------------------------------------------------------
// Translation checks: every multi-language text, in the manifest and in the
// tables of the code, carries exactly English, French, German and Spanish —
// the four languages of the Gladys interface — none empty, none too long, and
// the German one in the informal register ("du", never the polite "Sie").
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TEXTS } from '../src/i18n.js';
import { SIGN_IN_MESSAGES } from '../src/auth/signIn.js';
import { DETECTION_LABELS, WIDGET_TEXTS } from '../src/widgets.js';
import { LANGUAGES } from '../src/config.js';

const EXPECTED = ['de', 'en', 'es', 'fr'];
const LANGUAGE_KEYS = new Set(['en', 'fr', 'de', 'es']);
// Manifest keys that always hold a multi-language object.
const TEXT_KEYS = new Set(['label', 'description', 'placeholder', 'title']);
// The polite German pronouns, capitalized: the German texts say "du".
const POLITE_GERMAN = /\b(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)\b/;

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

/**
 * Every multi-language object of the manifest, with its JSON path. An object
 * counts when it sits under a text key, or when it has any language key: a
 * text that lost its English or gained a stray language is still found.
 */
function manifestTexts(node, path = '$', found = []) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => manifestTexts(item, `${path}[${i}]`, found));
  } else if (node && typeof node === 'object') {
    const keys = Object.keys(node);
    if (keys.some((k) => LANGUAGE_KEYS.has(k))) {
      found.push({ path, text: node });
      return found;
    }
    for (const [key, value] of Object.entries(node)) {
      if (TEXT_KEYS.has(key)) {
        assert.ok(
          value && typeof value === 'object' && !Array.isArray(value),
          `${path}.${key} must be a multi-language object`,
        );
        found.push({ path: `${path}.${key}`, text: value });
      } else {
        manifestTexts(value, `${path}.${key}`, found);
      }
    }
  }
  return found;
}

/** Every multi-language object of a code table (functions are called). */
function tableTexts(name, table) {
  return Object.entries(table).flatMap(([key, value]) => {
    if (typeof value === 'function') {
      return [
        { path: `${name}.${key}()`, text: value('') },
        { path: `${name}.${key}(…)`, text: value('sent to +1xxxxxx5678 via sms') },
      ];
    }
    return [{ path: `${name}.${key}`, text: value }];
  });
}

function codeTexts() {
  return [
    ...tableTexts('TEXTS', TEXTS),
    ...tableTexts('SIGN_IN_MESSAGES', SIGN_IN_MESSAGES),
    ...tableTexts('WIDGET_TEXTS', WIDGET_TEXTS),
    ...tableTexts('DETECTION_LABELS', DETECTION_LABELS),
  ];
}

/** The problems of one text, as messages ([] when it is fine). */
function checkText({ path, text }, maxLength = 1000) {
  const problems = [];
  const keys = Object.keys(text).sort();
  if (keys.join() !== EXPECTED.join()) {
    problems.push(`${path}: languages ${keys.join(', ')} instead of ${EXPECTED.join(', ')}`);
  }
  for (const [language, value] of Object.entries(text)) {
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${path}.${language} is empty`);
    } else if (value.length > maxLength) {
      problems.push(`${path}.${language} is ${value.length} characters (max ${maxLength})`);
    }
  }
  if (typeof text.de === 'string' && POLITE_GERMAN.test(text.de)) {
    problems.push(`${path}.de uses the polite form: "${text.de.match(POLITE_GERMAN)[0]}"`);
  }
  return problems;
}

// Bounds of the places where the text is displayed, from the store schemas
// (manifest and widget content) and the core.
const MAX_LENGTH = [
  [/^\$\.description$/, 100], // catalog description (10 to 100)
  [/^\$\.widgets\[\d+\]\.label$/, 30],
  [/^\$\.widgets\[\d+\]\.description$/, 100],
  [/^\$\.config_schema\[\d+\]\.description$/, 1000], // section text
];
const SHORT = 20; // widget buttons, tile labels, feature names
const WIDGET_SHORT = [
  'refresh',
  'lightOn',
  'lightOff',
  'sirenOn',
  'sirenOff',
  'battery',
  'lastRing',
  'lastMotion',
  'snapshotAt',
  'connection',
  'online',
  'offline',
  'never',
];

function maxLengthOf(path) {
  const bound = MAX_LENGTH.find(([pattern]) => pattern.test(path));
  if (bound) {
    return bound[1];
  }
  const [table, key] = path.split('.');
  if (table === 'WIDGET_TEXTS' && WIDGET_SHORT.includes(key)) {
    return SHORT;
  }
  if (table === 'WIDGET_TEXTS' && key.startsWith('toast')) {
    return 200; // the core truncates an action toast at 200 characters
  }
  if (table === 'WIDGET_TEXTS' && key === 'snapshotAlt') {
    return 100; // image alt
  }
  if (table === 'WIDGET_TEXTS') {
    return 300; // body text
  }
  if (table === 'TEXTS' && (key.startsWith('feature') || key.startsWith('mode'))) {
    return 40;
  }
  if (table === 'DETECTION_LABELS') {
    return SHORT;
  }
  return 1000;
}

test('every multi-language text of the manifest has en, fr, de and es', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length > 70, `only ${texts.length} texts found in the manifest`);
  const problems = texts.flatMap((t) => checkText(t, maxLengthOf(t.path)));
  assert.deepEqual(problems, []);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `${language}: ${text.length}`);
  }
});

test('every multi-language text of the code has en, fr, de and es', () => {
  const texts = codeTexts();
  assert.ok(texts.length > 50, `only ${texts.length} texts found in the code`);
  const problems = texts.flatMap((t) => checkText(t, maxLengthOf(t.path)));
  assert.deepEqual(problems, []);
});

test('the language of the device names offers the four languages', () => {
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(field.options.map((o) => o.value).sort(), [...EXPECTED]);
  assert.deepEqual([...LANGUAGES].sort(), [...EXPECTED]);
});

test('the checks catch a missing language, an empty text and the polite German', () => {
  const ok = { en: 'Doorbell', fr: 'Sonnette', de: 'Türklingel', es: 'Timbre' };
  assert.deepEqual(checkText({ path: 'ok', text: ok }), []);
  const { es: _es, ...noSpanish } = ok;
  assert.equal(checkText({ path: 'x', text: noSpanish }).length, 1);
  assert.equal(checkText({ path: 'x', text: { ...ok, it: 'Campanello' } }).length, 1);
  assert.equal(checkText({ path: 'x', text: { ...ok, de: ' ' } }).length, 1);
  assert.equal(checkText({ path: 'x', text: ok }, 5).length, 4);
  for (const word of ['Sie', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres']) {
    const text = { ...ok, de: `Wähle ${word} Kamera.` };
    assert.equal(checkText({ path: 'x', text }).length, 1, word);
  }
  assert.deepEqual(checkText({ path: 'x', text: { ...ok, de: 'Wähle deine Kamera.' } }), []);
  // A manifest text that lost a language, or a label left as a plain string.
  const broken = { label: { en: 'Camera', fr: 'Caméra' }, options: [{ label: 'Plain' }] };
  assert.throws(() => manifestTexts(broken), /must be a multi-language object/);
  const found = manifestTexts({ fields: [{ label: { en: 'Camera', fr: 'Caméra' } }] });
  assert.equal(found.flatMap((t) => checkText(t)).length, 1);
});
