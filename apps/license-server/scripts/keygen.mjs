// Generates the Ed25519 key pair of the licenses.
// - private key (base64 PEM) -> LICENSE_PRIVATE_KEY on the server, never committed
// - public key (PEM) -> packages/core/src/license/public-key.ts, shipped in the app
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' });
console.log('LICENSE_PRIVATE_KEY (base64) =');
console.log(Buffer.from(priv).toString('base64'));
console.log('\nPublic key =');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
