// Offline tests: argument parsing, PKCE, credential storage, the loopback
// callback handler (served against a fake authorize/token endpoint), and agent
// mode output shapes. Nothing here talks to clerk.sqid.dev.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sqid-cli-'));
process.env.SQID_CONFIG_DIR = tmp;

const { parseArgs } = await import('../src/args.js');
const { pkce } = await import('../src/oauth.js');
const creds = await import('../src/credentials.js');

test('parseArgs: command, positionals, flags with values, --no-, -h', () => {
  let r = parseArgs(['webhook', 'add', 'https://x.test/h', '--event', 'moment', '--once', '--no-browser', '--mode=agent', '-h']);
  assert.equal(r.command, 'webhook');
  assert.deepEqual(r.args, ['add', 'https://x.test/h']);
  assert.deepEqual(r.flags, { event : 'moment', once : true, browser : false, mode : 'agent', h : true });
});

test('pkce: S256 challenge of the verifier, url-safe, no padding', async () => {
  let { verifier, challenge } = pkce();
  let { createHash } = await import('node:crypto');
  let expect = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(challenge, expect);
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
});

test('credentials: file is 0600, env token wins, delete is idempotent', async () => {
  let file = await creds.writeCredentials({ access_token : 'a', refresh_token : 'r', expires_at : 1 });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await creds.readCredentials()).source, 'file');
  process.env.SQID_TOKEN = 'ak_env';
  assert.deepEqual(await creds.readCredentials(), { source : 'env', access_token : 'ak_env' });
  delete process.env.SQID_TOKEN;
  assert.equal(await creds.deleteCredentials(), true);
  assert.equal(await creds.deleteCredentials(), false);
  assert.equal(await creds.readCredentials(), null);
});

// A fake issuer: discovery + authorize (redirects straight back with a code) + token.
async function fakeIssuer(){
  let seen = {};
  let server = http.createServer(async (req, res) => {
    let u = new URL(req.url, 'http://x');
    if(u.pathname === '/.well-known/openid-configuration'){
      let o = `http://127.0.0.1:${server.address().port}`;
      return res.end(JSON.stringify({ issuer : o, authorization_endpoint : o + '/authorize', token_endpoint : o + '/token', userinfo_endpoint : o + '/userinfo', revocation_endpoint : o + '/revoke' }));
    }
    if(u.pathname === '/authorize'){
      seen.authorize = Object.fromEntries(u.searchParams);
      res.writeHead(302, { location : `${u.searchParams.get('redirect_uri')}?code=c0de&state=${u.searchParams.get('state')}` });
      return res.end();
    }
    if(u.pathname === '/token'){
      let body = ''; for await (let c of req){ body += c; }
      seen.token = Object.fromEntries(new URLSearchParams(body));
      let exp = Math.floor(Date.now() / 1000) + 86400;
      let jwt = ['eyJhbGciOiJSUzI1NiIsInR5cCI6ImF0K2p3dCJ9', Buffer.from(JSON.stringify({ sub : 'user_1', exp })).toString('base64url'), 'sig'].join('.');
      return res.end(JSON.stringify({ access_token : jwt, refresh_token : 'rt', token_type : 'bearer', expires_in : 31622400, scope : 'email profile offline_access' }));
    }
    if(u.pathname === '/userinfo'){ return res.end(JSON.stringify({ sub : 'user_1', email : 'dev@acme.com' })); }
    if(u.pathname === '/revoke'){ seen.revoked = true; return res.end('{}'); }
    res.statusCode = 404; res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, seen, origin : `http://127.0.0.1:${server.address().port}` };
}

function runCli(args, env = {}){
  return new Promise((resolve) => {
    let child = spawn(process.execPath, [path.resolve('bin/sqid.js'), ...args], { env : { ...process.env, SQID_MODE : 'agent', ...env } });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('close', code => resolve({ code, out, err }));
  });
}

test('login (loopback): PKCE + state round trip, exp from the JWT, then logout revokes', async () => {
  let { server, seen, origin } = await fakeIssuer();
  try{
    // --no-browser prints the URL on stderr as an event; follow it ourselves like a browser would.
    let child = spawn(process.execPath, [path.resolve('bin/sqid.js'), 'login', '--no-browser'], { env : { ...process.env, SQID_MODE : 'agent', SQID_OAUTH_ISSUER : origin } });
    let url = await new Promise((resolve) => child.stderr.on('data', d => { let m = String(d).match(/"url":"([^"]+)"/); if(m){ resolve(m[1]); } }));
    let r1 = await fetch(url, { redirect : 'manual' });
    let cb = await fetch(r1.headers.get('location'));
    assert.equal(cb.status, 200);
    assert.match(await cb.text(), /signed in to Sqid/);
    let out = ''; child.stdout.on('data', d => out += d);
    let code = await new Promise(r => child.on('close', r));
    assert.equal(code, 0, out);
    let res = JSON.parse(out);
    assert.equal(res.data.email, 'dev@acme.com');
    assert.equal(seen.authorize.code_challenge_method, 'S256');
    assert.equal(seen.token.grant_type, 'authorization_code');
    assert.equal(seen.token.code, 'c0de');
    assert.equal(seen.token.redirect_uri, seen.authorize.redirect_uri);
    assert.match(seen.token.code_verifier, /^[A-Za-z0-9_-]{43}$/);

    let saved = JSON.parse(await fs.readFile(path.join(tmp, 'credentials.json'), 'utf8'));
    assert.ok(Math.abs(saved.expires_at - (Date.now() + 86400e3)) < 5000, 'expires_at comes from the JWT exp, not expires_in');

    let again = await runCli(['login'], { SQID_OAUTH_ISSUER : origin });
    assert.equal(JSON.parse(again.out).data.signed_in, true, 'second login is a no-op');

    let noYes = await runCli(['logout'], { SQID_OAUTH_ISSUER : origin });
    assert.equal(noYes.code, 2); assert.equal(JSON.parse(noYes.err).error.code, 'confirm_required');

    let lo = await runCli(['auth', 'logout', '--yes'], { SQID_OAUTH_ISSUER : origin });
    assert.deepEqual(JSON.parse(lo.out).data, { signed_out : true, revoked : true });
    assert.equal(seen.revoked, true);
  } finally { server.close(); }
});

test('agent mode: not signed in is exit 3 with a remedy; unknown command is exit 2', async () => {
  let w = await runCli(['whoami']);
  assert.equal(w.code, 3);
  assert.equal(JSON.parse(w.err).error.code, 'not_signed_in');
  let x = await runCli(['nope']);
  assert.equal(x.code, 2);
  assert.equal(JSON.parse(x.err).error.code, 'usage');
});

test('--input-json: flat object becomes flags, explicit flags win, nested refused', async () => {
  let r = await runCli(['init', '--input-json', '{"url":"https://a.test","siteName":"X","yes":false}', '--url', 'https://b.test']);
  // not signed in -> exit 3, but flags were parsed first: a bad JSON would have been exit 2
  assert.equal(r.code, 3);
  let bad = await runCli(['init', '--input-json', '{"a":{"b":1}}']);
  assert.equal(bad.code, 2); assert.equal(JSON.parse(bad.err).error.code, 'invalid_json');
});

test('help: top-level usage, command help, aliases', async () => {
  let h = await runCli(['--help'], { SQID_MODE : 'human' });
  assert.match(h.out, /^Usage: sqid \[options\] \[command\]/);
  let a = await runCli(['help', 'auth'], { SQID_MODE : 'human' });
  assert.match(a.out, /sqid auth <command>/);
  let st = await runCli(['auth', 'status']);
  assert.equal(JSON.parse(st.out).data.signed_in, false);
});

test('README usage block matches src/index.js USAGE', async () => {
  const { USAGE } = await import('../src/index.js');
  let readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');
  let block = readme.split('## Usage\n\n```\n')[1].split('```')[0];
  let usage = USAGE.replace(/\n\nDocs:.*\n$/, '\n');
  assert.equal(block, usage);
});
