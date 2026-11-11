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
    assert.ok(Math.abs(saved.expires_at - (Date.now() + 86400e3)) < 60_000, 'expires_at comes from the JWT exp (1 day), not expires_in (366 days)');

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

async function fakeApi(){
  let seen = [];
  let hooks = [];
  let server = http.createServer(async (req, res) => {
    let body = ''; for await (let c of req){ body += c; }
    let u = new URL(req.url, 'http://x');
    seen.push({ method : req.method, path : u.pathname, query : Object.fromEntries(u.searchParams), body : body ? JSON.parse(body) : null, auth : req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if(u.pathname === '/api/sqid/me'){ return res.end(JSON.stringify({ email : 'dev@acme.com', role : 'owner', account : { hasSubscription : true } })); }
    if(u.pathname === '/api/sqid/projects'){ return res.end(JSON.stringify([{ _id : 'sdk1', name : 'Acme', enabled : true, state : { deployed : true, connected : true } }])); }
    if(u.pathname === '/api/sqid/sdks/sdk1/webhooks'){ return res.end(JSON.stringify(hooks)); }
    if(req.method === 'POST' && /\/projects\/sdk1\/webhook$/.test(u.pathname)){ let b = JSON.parse(body); let w = { id : 'wh' + (hooks.length + 1), name : b.name, namespace : b.namespace, enabled : b.enabled, url : b.source.webhook_url, health : { status : 'no_deliveries' }, totals : { success : 0, failed : 0 } }; hooks.push(w); return res.end(JSON.stringify({ _id : w.id })); }
    if(req.method === 'POST' && /\/webhook\/test$/.test(u.pathname)){ return res.end(JSON.stringify({ request : { payload : { hello : 1 } }, response : { success : true, status : 200, data : 'ok' } })); }
    if(req.method === 'DELETE'){ hooks = hooks.filter(h => !u.pathname.endsWith('/' + h.id)); return res.end('{}'); }
    res.statusCode = 404; res.end(JSON.stringify({ error : 'nope' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, seen, origin : `http://127.0.0.1:${server.address().port}` };
}

test('webhook: add defaults to identification (v2 route), page uses v1 with settings, list, test, delete needs --yes', async () => {
  let { server, seen, origin } = await fakeApi();
  let env = { SQID_API : origin, SQID_TOKEN : 'ak_test' };
  try{
    let a = await runCli(['webhook', 'add', 'https://acme.test/api/visitors'], env);
    assert.equal(a.code, 0, a.err);
    let add = seen.find(r => r.method === 'POST' && r.path.endsWith('/webhook'));
    assert.equal(add.path, '/api/v2/projects/sdk1/webhook', 'identification goes to the v2 route');
    assert.equal(add.body.namespace, 'visitor.identification.created.v2');
    assert.equal(add.body.source.webhook_url, 'https://acme.test/api/visitors');
    assert.equal(add.body.source.settings, undefined, 'v2 has no payload sections');
    assert.equal(add.auth, 'Bearer ak_test');
    assert.match(JSON.parse(a.out).data.name, /acme\.test/);

    let m = await runCli(['webhook', 'add', 'https://acme.test/api/moments', '--event', 'moment'], env);
    assert.equal(JSON.parse(m.out).data.namespace, 'visitor.moment.created.v2');

    let pg = await runCli(['webhook', 'add', 'https://acme.test/api/pages', '--event', 'page', '--auth', 'u:p:w'], env);
    assert.equal(pg.code, 0, pg.err);
    let v1 = seen.filter(r => r.method === 'POST' && r.path === '/api/projects/sdk1/webhook').pop();
    assert.equal(v1.body.namespace, 'visitor.connection.event');
    assert.equal(v1.body.source.settings.context.enabled, true);
    assert.deepEqual(v1.body.source.auth, { username : 'u', password : 'p:w' });

    let bad = await runCli(['webhook', 'add', 'http://acme.test/x'], env);
    assert.equal(bad.code, 2, 'http refused before any call');

    let l = await runCli(['webhook', 'list'], env);
    let rows = JSON.parse(l.out).data;
    assert.deepEqual(rows.map(r => r.event), ['identification', 'moment', 'page']);

    let t = await runCli(['webhook', 'test', 'wh1'], env);
    assert.equal(JSON.parse(t.out).data.delivered, true);
    assert.equal(seen.filter(r => r.path.endsWith('/webhook/test')).pop().path, '/api/v2/projects/sdk1/webhook/test');

    let d = await runCli(['webhook', 'delete', 'wh3'], env);
    assert.equal(d.code, 2); assert.equal(JSON.parse(d.err).error.code, 'confirm_required');
    let dy = await runCli(['webhook', 'delete', 'wh3', '--yes'], env);
    assert.equal(JSON.parse(dy.out).data.deleted, true);
    assert.equal(seen.filter(r => r.method === 'DELETE').pop().path, '/api/projects/sdk1/webhook/wh3', 'v1 webhook deleted on the v1 route');
  } finally { server.close(); }
});

test('skill install: copies SKILL.md and references into the global Claude folder only, by default', async () => {
  let home = await fs.mkdtemp(path.join(os.tmpdir(), 'sqid-home-'));
  let r = await runCli(['skill', 'install'], { HOME : home });
  assert.equal(r.code, 0, r.err);
  let out = JSON.parse(r.out).data.installed;
  assert.deepEqual(out.map(i => i.agent), ['claude']);
  let md = await fs.readFile(path.join(home, '.claude', 'skills', 'sqid', 'SKILL.md'), 'utf8');
  assert.match(md, /^---\nname: sqid\n/);
  assert.ok(await fs.stat(path.join(home, '.claude', 'skills', 'sqid', 'references', 'identification.md')));
  let p = await runCli(['skill', 'path']);
  assert.match(JSON.parse(p.out).data.path, /skill\/sqid\/$/);
});

test('skill: SKILL.md leads with identification before moments and names only commands that exist', async () => {
  let md = await fs.readFile(new URL('../skill/sqid/SKILL.md', import.meta.url), 'utf8');
  assert.ok(md.indexOf('Tell me who is on my site') < md.indexOf('Send visitor moments'), 'identification first');
  const { USAGE } = await import('../src/index.js');
  let known = new Set(USAGE.split('Commands:')[1].split('\n').map(l => l.trim().split(/\s+/)[0]).filter(Boolean));
  for(let m of md.matchAll(/`sqid ([a-z]+)/g)){ assert.ok(known.has(m[1]) || m[1] === 'skill', `SKILL.md names unknown command: sqid ${m[1]}`); }
});

test('visitors + enrich + keys: identities list, profile get, SDK key minted once and reused for the public API', async () => {
  let seen = [];
  let keys = [];
  let pub = http.createServer(async (req, res) => { let b = ''; for await (let c of req){ b += c; } seen.push({ pub : true, path : req.url, auth : req.headers.authorization, body : JSON.parse(b || 'null') }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ person : { name : 'Jane' } })); });
  await new Promise(r => pub.listen(0, '127.0.0.1', r));
  let server = http.createServer(async (req, res) => {
    let b = ''; for await (let c of req){ b += c; }
    let u = new URL(req.url, 'http://x'); seen.push({ method : req.method, path : u.pathname, query : Object.fromEntries(u.searchParams), body : b ? JSON.parse(b) : null });
    res.setHeader('content-type', 'application/json');
    if(u.pathname === '/api/sqid/projects'){ return res.end(JSON.stringify([{ _id : 'sdk1', name : 'Acme', state : {} }])); }
    if(u.pathname === '/api/sqid/identities'){ return res.end(JSON.stringify({ identities : [{ _id : 'p1', sdk_id : 'sdk1', user : { firstName : 'Jane', lastName : 'Park', email : 'jane@northwind.test', company : 'Northwind' }, last_seen_at : '2026-11-11T10:00:00Z' }], next : { before : 1, seen : ['p1'] } })); }
    if(u.pathname === '/api/projects/sdk1/profiles/p1'){ return res.end(JSON.stringify({ _id : 'p1', user : { email : 'jane@northwind.test' } })); }
    if(u.pathname === '/api/sdks/sdk1/tokens' && req.method === 'GET'){ return res.end(JSON.stringify(keys)); }
    if(u.pathname === '/api/sdks/sdk1/tokens' && req.method === 'POST'){ let k = { _id : 'k1', name : JSON.parse(b).name, jwt : 'sdkjwt.' + keys.length }; keys.push(k); return res.end(JSON.stringify(k)); }
    res.statusCode = 404; res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let cfg = await fs.mkdtemp(path.join(os.tmpdir(), 'sqid-cfg-'));
  await fs.writeFile(path.join(cfg, 'credentials.json'), JSON.stringify({ access_token : 'oat', refresh_token : 'r', expires_at : Date.now() + 86400e3 }));
  let env = { SQID_API : `http://127.0.0.1:${server.address().port}`, SQID_PUBLIC_API : `http://127.0.0.1:${pub.address().port}`, SQID_CONFIG_DIR : cfg, SQID_TOKEN : '' };
  try{
    let l = await runCli(['visitors', 'list', '--search', 'nor'], env);
    assert.equal(l.code, 0, l.err);
    let d = JSON.parse(l.out);
    assert.equal(d.data.visitors[0].email, 'jane@northwind.test');
    assert.equal(d.data.visitors[0].site, 'Acme');
    assert.deepEqual(seen.find(r => r.path === '/api/sqid/identities').query, { sdk : 'sdk1', q : 'nor' });
    assert.match(d.next[0].command, /--before 1 --seen p1/);
    let short = await runCli(['visitors', 'list', '--search', 'no'], env);
    assert.equal(short.code, 2);

    let g = await runCli(['visitors', 'get', 'p1'], env);
    assert.equal(JSON.parse(g.out).data.user.email, 'jane@northwind.test');

    let e1 = await runCli(['enrich', '--email', 'jane@northwind.test'], env);
    assert.equal(e1.code, 0, e1.err);
    assert.equal(JSON.parse(e1.out).data.person.name, 'Jane');
    let e2 = await runCli(['enrich', '--linkedin', 'https://www.linkedin.com/in/jane', '--force'], env);
    assert.equal(e2.code, 0, e2.err);
    assert.equal(seen.filter(r => r.method === 'POST' && r.path === '/api/sdks/sdk1/tokens').length, 1, 'one key minted, then reused from the credentials file');
    let pubCalls = seen.filter(r => r.pub);
    assert.equal(pubCalls.length, 2);
    assert.equal(pubCalls[0].auth, 'Bearer sdkjwt.0');
    assert.deepEqual(pubCalls[1].body, { linkedin_url : 'https://www.linkedin.com/in/jane', forceUpdate : true });
    let saved = JSON.parse(await fs.readFile(path.join(cfg, 'credentials.json'), 'utf8'));
    assert.equal(saved.sdk_keys.sdk1, 'sdkjwt.0');

    let both = await runCli(['enrich', '--email', 'a@b.c', '--phone', '+1'], env);
    assert.equal(both.code, 2);
    let kl = await runCli(['keys', 'list'], env);
    assert.equal(JSON.parse(kl.out).data[0].key, 'sdkjwt.0');
  } finally { server.close(); pub.close(); }
});
