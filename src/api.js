// Authenticated calls to app.sqid.dev with the OAuth token. Refreshes 30 s
// before expiry and persists the new token. SQID_TOKEN (an account key or a
// token) is used as is.

import { readCredentials, writeCredentials } from './credentials.js';
import { refresh } from './oauth.js';
import { API_ORIGIN } from './meta.js';
import { CliError, notSignedIn } from './errors.js';

export async function accessToken(){
  let creds = await readCredentials();
  if(!creds?.access_token){ throw notSignedIn(); }
  if(creds.source === 'file' && creds.refresh_token && creds.expires_at && creds.expires_at - Date.now() < 30_000){
    let fresh = await refresh(creds.refresh_token);
    creds = { ...creds, ...fresh };
    let { source, ...toSave } = creds;
    await writeCredentials(toSave);
  }
  return creds;
}

export async function api(method, path, { body, flags, token } = {}){
  let origin = flags?.api || API_ORIGIN;
  let creds  = token ? { access_token : token } : await accessToken();
  let res = await fetch(origin + path, {
    method,
    headers : { authorization : `Bearer ${creds.access_token}`, accept : 'application/json', ...(body ? { 'content-type' : 'application/json' } : {}), 'user-agent' : 'sqid-cli' },
    body    : body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try{ data = await res.json(); }catch(error){ /* not json */ }
  if(res.status === 401){ throw new CliError('unauthorized', 'Sqid did not accept this token.', 'Sign in again.', [{ command : 'sqid auth login', description : 'Sign in with your browser' }], undefined, 3); }
  if(res.status === 403 && data?.clerk_error?.reason === 'reverification-error'){ throw new CliError('console_only', 'This action needs a fresh second factor and is only available in the console.', `Open ${origin} in your browser.`); }
  if(!res.ok){ throw new CliError(data?.error || `http_${res.status}`, data?.message || data?.error || `${method} ${path} failed (${res.status})`, '', [], undefined); }
  return data;
}
