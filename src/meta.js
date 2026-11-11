import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json');

export const version = pkg.version;

// The sqid CLI is a public OAuth client of Sqid's Clerk instance (PKCE, no
// secret). Created 2026-11-11. Override for a dev instance with SQID_OAUTH_ISSUER
// and SQID_OAUTH_CLIENT_ID.
export const OAUTH = {
  issuer   : process.env.SQID_OAUTH_ISSUER    || 'https://clerk.sqid.dev',
  clientId : process.env.SQID_OAUTH_CLIENT_ID || '7D87N4dGhW5IVr5j',
  scopes   : 'email profile offline_access'
};

export const API_ORIGIN = process.env.SQID_API || 'https://app.sqid.dev';
export const DOCS       = 'https://docs.sqid.dev';
