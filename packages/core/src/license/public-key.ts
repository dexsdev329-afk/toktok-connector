/**
 * Public key of the license server (Ed25519). The matching private key is the LICENSE_PRIVATE_KEY
 * variable of apps/license-server on Railway and is never committed. See apps/license-server/README.md
 * (key rotation).
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAudVkNEpKxst5Fj8cqfI+8GmgYGwlPGTA+a3gPVTGnoo=
-----END PUBLIC KEY-----`;
