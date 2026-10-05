/**
 * Public key of the license server (Ed25519), as served by
 * https://license-server-production-bb36.up.railway.app/v1/public-key. The private key never leaves
 * the server (generated there, kept in its database). See apps/license-server/README.md.
 */
export const LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAF3F+U6sQ7+ckYa8TzqRjbn5r2U30nTT+o0mSc8ANz5U=
-----END PUBLIC KEY-----`;
