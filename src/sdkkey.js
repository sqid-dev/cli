// SDK keys: the public API's /visitors/* endpoints take a key bound to one site.
// The CLI makes one per site on first need ("CLI on <hostname>"), through the
// console's own key route, and keeps it in the credentials file next to the OAuth
// tokens. The console lists it like any other key, so it can be revoked there.

import os from 'node:os';
import { api } from './api.js';
import { readCredentials, writeCredentials } from './credentials.js';

export const PUBLIC_API = process.env.SQID_PUBLIC_API || 'https://app.asksquid.ai/api/v1';
const keyName = () => `CLI on ${os.hostname()}`.slice(0, 60);

export async function sdkKeyFor(site, flags){
  let creds = await readCredentials();
  let saved = creds?.sdk_keys?.[site.id];
  if(saved){ return saved; }

  let existing = await api('GET', `/api/sdks/${site.id}/tokens`, { flags });
  let list = Array.isArray(existing) ? existing : existing?.tokens || [];
  let mine = list.find(t => t.name === keyName() && t.jwt);
  let jwt  = mine?.jwt;
  if(!jwt){
    let made = await api('POST', `/api/sdks/${site.id}/tokens`, { flags, body : { name : keyName() } });
    jwt = made?.jwt;
  }
  if(!jwt){ throw new Error('Sqid returned no key'); }
  if(creds?.source === 'file'){
    let { source, ...rest } = creds;
    await writeCredentials({ ...rest, sdk_keys : { ...(rest.sdk_keys || {}), [site.id] : jwt } });
  }
  return jwt;
}

export async function publicApi(method, path, { key, body } = {}){
  let res = await fetch(PUBLIC_API + path, {
    method,
    headers : { authorization : `Bearer ${key}`, accept : 'application/json', 'user-agent' : 'sqid-cli', ...(body ? { 'content-type' : 'application/json' } : {}) },
    body    : body ? JSON.stringify(body) : undefined
  });
  let data = null; try{ data = await res.json(); }catch(error){ /* not json */ }
  return { ok : res.ok, status : res.status, data };
}
