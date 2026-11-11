// OAuth against Sqid's Clerk instance. Two ways in, both standard:
//
//   loopback   authorization code + PKCE. A one-shot HTTP listener on
//              127.0.0.1:<random port>, the browser opens /oauth/authorize, Clerk
//              redirects back with the code, we exchange it. Same shape as
//              Claude Code's own login.
//   device     device authorization grant for SSH and containers: print a URL and
//              a code, poll the token endpoint until the person approves.
//
// Endpoints come from the issuer's discovery document at runtime.

import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { OAUTH } from './meta.js';
import { CliError } from './errors.js';

let _discovery = null;
export async function discovery(){
  if(_discovery){ return _discovery; }
  let res = await fetch(`${OAUTH.issuer}/.well-known/openid-configuration`);
  if(!res.ok){ throw new CliError('oauth_discovery_failed', `Could not read ${OAUTH.issuer}/.well-known/openid-configuration (${res.status}).`, 'Check your network, or SQID_OAUTH_ISSUER if you set it.'); }
  _discovery = await res.json();
  return _discovery;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkce(){
  let verifier  = b64url(crypto.randomBytes(32));
  let challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

// Try to open the URL; never fail if we cannot. The caller always prints it too.
export function openBrowser(url){
  let cmd, args;
  if(process.platform === 'darwin'){ cmd = 'open'; args = [url]; }
  else if(process.platform === 'win32'){ cmd = 'cmd'; args = ['/c', 'start', '', url.replace(/&/g, '^&')]; }
  else { cmd = 'xdg-open'; args = [url]; }
  try{
    let child = spawn(cmd, args, { stdio : 'ignore', detached : true });
    child.on('error', () => {});
    child.unref();
    return true;
  }catch(error){ return false; }
}

async function tokenRequest(body){
  let d   = await discovery();
  let res = await fetch(d.token_endpoint, {
    method  : 'POST',
    headers : { 'content-type' : 'application/x-www-form-urlencoded', accept : 'application/json' },
    body    : new URLSearchParams({ client_id : OAUTH.clientId, ...body })
  });
  let json = await res.json().catch(() => ({}));
  if(!res.ok){
    let e = new Error(json.error_description || json.error || `token endpoint ${res.status}`);
    e.oauth = json.error || 'token_error';
    e.status = res.status;
    throw e;
  }
  return normalise(json);
}

function normalise(t){
  return {
    access_token  : t.access_token,
    refresh_token : t.refresh_token,
    token_type    : t.token_type,
    scope         : t.scope,
    expires_at    : expiresAt(t),
    id_token      : t.id_token
  };
}

// Clerk's access tokens are JWTs (typ at+jwt) whose exp claim is the truth; the
// expires_in in the token response did not match it when tested (2026-11-11), so
// prefer the claim and fall back to expires_in for opaque tokens.
function expiresAt(t){
  try{
    let [, payload] = String(t.access_token || '').split('.');
    let exp = payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).exp : null;
    if(typeof exp === 'number'){ return exp * 1000; }
  }catch(error){ /* opaque token */ }
  return t.expires_in ? Date.now() + t.expires_in * 1000 : undefined;
}

// ---- Loopback (browser) flow ------------------------------------------------------
export async function loginLoopback({ onUrl, timeoutMs = 10 * 60 * 1000, open = true } = {}){
  let d = await discovery();
  let { verifier, challenge } = pkce();
  let state = b64url(crypto.randomBytes(16));

  let server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  let port = server.address().port;
  let redirect = `http://127.0.0.1:${port}/callback`;

  let url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type         : 'code',
    client_id             : OAUTH.clientId,
    redirect_uri          : redirect,
    scope                 : OAUTH.scopes,
    state,
    code_challenge        : challenge,
    code_challenge_method : 'S256'
  }).toString();

  let opened = open ? openBrowser(url.toString()) : false;
  onUrl?.(url.toString(), { opened, port });

  let code;
  try{
    code = await new Promise((resolve, reject) => {
      let timer = setTimeout(() => reject(new CliError('login_timeout', 'No sign-in arrived within 10 minutes.', 'Run `sqid login` again, or `sqid login --device` if this machine has no browser.')), timeoutMs);
      server.on('request', (req, res) => {
        let u = new URL(req.url, redirect);
        if(u.pathname !== '/callback'){ res.statusCode = 404; return res.end('Not found'); }
        let err = u.searchParams.get('error');
        let got = u.searchParams.get('code');
        let st  = u.searchParams.get('state');
        if(err || !got || st !== state){
          res.writeHead(400, { 'content-type' : 'text/html; charset=utf-8' }).end(page('Sign-in did not complete', err ? `${err}: ${u.searchParams.get('error_description') || ''}` : 'Missing code or state. Go back to your terminal and run <code>sqid login</code> again.'));
          clearTimeout(timer);
          return reject(new CliError('login_denied', err ? `Sign-in refused: ${err}` : 'Callback without a valid code.', 'Run `sqid login` again.'));
        }
        res.writeHead(200, { 'content-type' : 'text/html; charset=utf-8' }).end(page('You’re signed in to Sqid', 'You can close this window and go back to your terminal.'));
        clearTimeout(timer);
        resolve(got);
      });
    });
  } finally {
    // Give the browser a beat to receive the page, then close.
    setTimeout(() => server.close(), 500).unref();
  }

  try{
    return await tokenRequest({ grant_type : 'authorization_code', code, redirect_uri : redirect, code_verifier : verifier });
  }catch(error){
    throw new CliError('token_exchange_failed', `Clerk refused the code exchange: ${error.message}`, 'Run `sqid login` again. If it keeps failing, the OAuth app’s redirect URI may not allow loopback ports.', [], error);
  }
}

// ---- Device flow -----------------------------------------------------------------
export async function loginDevice({ onCode, timeoutMs = 15 * 60 * 1000 } = {}){
  let d = await discovery();
  if(!d.device_authorization_endpoint){ throw new CliError('device_flow_unavailable', 'This Sqid instance does not offer the device flow.', 'Use `sqid login` on a machine with a browser.'); }
  let res = await fetch(d.device_authorization_endpoint, {
    method  : 'POST',
    headers : { 'content-type' : 'application/x-www-form-urlencoded', accept : 'application/json' },
    body    : new URLSearchParams({ client_id : OAUTH.clientId, scope : OAUTH.scopes })
  });
  let dev = await res.json().catch(() => ({}));
  if(!res.ok){ throw new CliError('device_start_failed', dev.error_description || dev.error || `device endpoint ${res.status}`, 'Try again in a moment.'); }

  onCode?.({ url : dev.verification_uri_complete || dev.verification_uri, code : dev.user_code, verification_uri : dev.verification_uri });

  let interval = Math.max(2, dev.interval || 5) * 1000;
  let until    = Date.now() + Math.min(timeoutMs, (dev.expires_in || 900) * 1000);
  while(Date.now() < until){
    await new Promise(r => setTimeout(r, interval));
    try{
      return await tokenRequest({ grant_type : 'urn:ietf:params:oauth:grant-type:device_code', device_code : dev.device_code });
    }catch(error){
      if(error.oauth === 'authorization_pending'){ continue; }
      if(error.oauth === 'slow_down'){ interval += 5000; continue; }
      if(error.oauth === 'expired_token'){ break; }
      if(error.oauth === 'access_denied'){ throw new CliError('login_denied', 'Sign-in was refused in the browser.', 'Run `sqid login --device` again.'); }
      throw new CliError('token_exchange_failed', error.message, 'Run `sqid login --device` again.', [], error);
    }
  }
  throw new CliError('login_timeout', 'The device code expired before it was approved.', 'Run `sqid login --device` again.');
}

// ---- Refresh and revoke ------------------------------------------------------------
export async function refresh(refreshToken){
  try{
    let t = await tokenRequest({ grant_type : 'refresh_token', refresh_token : refreshToken });
    return { ...t, refresh_token : t.refresh_token || refreshToken };
  }catch(error){
    throw new CliError('refresh_failed', `Could not refresh the session: ${error.message}`, 'Sign in again.', [{ command : 'sqid login', description : 'Sign in with your browser' }], error, 3);
  }
}

export async function revoke(token, hint){
  let d = await discovery();
  if(!d.revocation_endpoint || !token){ return false; }
  let res = await fetch(d.revocation_endpoint, {
    method  : 'POST',
    headers : { 'content-type' : 'application/x-www-form-urlencoded' },
    body    : new URLSearchParams({ client_id : OAUTH.clientId, token, ...(hint ? { token_type_hint : hint } : {}) })
  });
  return res.ok;
}

export async function userinfo(accessToken){
  let d   = await discovery();
  let res = await fetch(d.userinfo_endpoint, { headers : { authorization : `Bearer ${accessToken}` } });
  if(!res.ok){ return null; }
  return res.json();
}

// The page the browser lands on. Plain, no assets, readable in light and dark.
function page(title, body){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#1c1917;--fg:#fafaf9;--muted:#a8a29e}}
html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{min-height:100%;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center}
h1{font-size:28px;font-weight:600;margin:0 0 8px}p{margin:0;color:var(--muted)}code{font-family:ui-monospace,Menlo,monospace}
</style></head><body><main><div><h1>${esc(title)}</h1><p>${body}</p></div></main></body></html>`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&' : '&amp;', '<' : '&lt;', '>' : '&gt;', '"' : '&quot;' })[c]);
