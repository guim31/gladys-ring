// Motion and ding notifications reach the integration through Firebase Cloud
// Messaging, decrypted by @eneris/push-receiver (a dependency of
// ring-client-api). FCM now sends the crypto-key header as
// "dh=KEY; p256ecdsa=SIG"; version 4.3.0 kept the suffix in the key and failed
// every message with ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY (issue #15). The
// version pinned by `overrides` in package.json must decrypt such a message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decrypt = require('@eneris/push-receiver/dist/utils/decrypt.js').default;
const ece = require(
  require.resolve('http_ece', { paths: [require.resolve('@eneris/push-receiver')] }),
);

test('push-receiver decrypts an FCM message whose crypto-key carries p256ecdsa', () => {
  const receiver = crypto.createECDH('prime256v1');
  receiver.generateKeys();
  const sender = crypto.createECDH('prime256v1');
  sender.generateKeys();
  const authSecret = crypto.randomBytes(16).toString('base64');
  const salt = crypto.randomBytes(16).toString('base64url');
  const payload = { data: { gcmData: { event: 'motion' } } };

  const rawData = ece.encrypt(Buffer.from(JSON.stringify(payload)), {
    version: 'aesgcm',
    privateKey: sender,
    dh: receiver.getPublicKey('base64url'),
    authSecret,
    salt,
  });
  const message = {
    rawData,
    appData: [
      {
        key: 'crypto-key',
        value: `dh=${sender.getPublicKey('base64url')}; p256ecdsa=${crypto.randomBytes(65).toString('base64url')}`,
      },
      { key: 'encryption', value: `salt=${salt}` },
    ],
  };

  const keys = { privateKey: receiver.getPrivateKey('base64'), authSecret };
  assert.deepEqual(decrypt(message, keys), payload);
});
