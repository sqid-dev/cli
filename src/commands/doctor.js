// Is this project ready? Each check: { name, status: ok|warn|fail, message, remedy?, fix? }.
// Exit 0 when nothing failed, 1 otherwise.

import fs from 'node:fs/promises';
import path from 'node:path';
import { readCredentials } from '../credentials.js';
import { api } from '../api.js';
import { readProject, projectDir, listSites } from '../project.js';

export const help = `sqid doctor [--site <id|name>]

Checks: signed in, account has a plan, site exists, snippet present in this
project, site deployed (first page view seen) and connected, any webhooks failing.
`;

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage', '.cache', 'vendor', '.svelte-kit', '.turbo']);
const TEXT = /\.(html?|jsx?|tsx?|vue|svelte|astro|ejs|hbs|liquid|php|erb|twig|njk|mdx?|pug)$/i;

async function grepProject(needle, root, budget = { files : 0 }){
  let entries;
  try{ entries = await fs.readdir(root, { withFileTypes : true }); }catch(error){ return null; }
  for(let e of entries){
    if(budget.files > 4000){ return null; }
    let full = path.join(root, e.name);
    if(e.isDirectory()){ if(SKIP.has(e.name) || e.name.startsWith('.')){ continue; } let hit = await grepProject(needle, full, budget); if(hit){ return hit; } continue; }
    if(!TEXT.test(e.name)){ continue; }
    budget.files++;
    try{ let st = await fs.stat(full); if(st.size > 2_000_000){ continue; } let s = await fs.readFile(full, 'utf8'); if(s.includes(needle)){ return path.relative(projectDir(), full); } }catch(error){ /* skip */ }
  }
  return null;
}

export async function run({ flags }){
  let checks = [];
  const add = (name, status, message, remedy, fix) => checks.push({ name, status, message, ...(remedy ? { remedy } : {}), ...(fix ? { fix } : {}) });

  let creds = await readCredentials();
  if(!creds){ add('signed_in', 'fail', 'Not signed in on this machine.', 'Sign in.', 'sqid login'); return finish(checks); }
  add('signed_in', 'ok', creds.source === 'env' ? 'SQID_TOKEN is set.' : `Signed in${creds.email ? ' as ' + creds.email : ''}.`);

  let me;
  try{ me = await api('GET', '/api/sqid/me', { flags }); }
  catch(error){ add('api', 'fail', `Sqid did not accept the token (${error.code}).`, 'Sign in again.', 'sqid login --force'); return finish(checks); }
  add('plan', me.account?.hasSubscription ? 'ok' : 'warn', me.account?.hasSubscription ? 'Account has a plan.' : 'No plan yet; the free Developer plan starts with the first site.', me.account?.hasSubscription ? undefined : 'Create a site.', me.account?.hasSubscription ? undefined : 'sqid init --url https://example.com');

  let project = await readProject();
  let sites = await listSites(flags);
  let real = sites.filter(s => !s.sandbox);
  let site = flags.site ? sites.find(s => s.id === String(flags.site) || s.name?.toLowerCase() === String(flags.site).toLowerCase()) : project?.site ? sites.find(s => s.id === project.site) : real.length === 1 ? real[0] : null;
  if(!project && !flags.site){ add('project_file', 'warn', 'No .sqid.json in this folder.', 'Run init here so commands know the site.', 'sqid init'); }
  if(!site && !project?.site && !flags.site && real.length > 1){ add('site', 'warn', `This account can see ${real.length} sites; none is chosen for this folder.`, 'Run init here, or pass --site.', `sqid doctor --site ${real[0].id}`); return finish(checks); }
  if(!site){ add('site', 'fail', project?.site ? `Site ${project.site} from .sqid.json is not visible to this account.` : 'No site found.', 'Create one.', 'sqid init --url https://example.com'); return finish(checks); }
  add('site', 'ok', `Site "${site.name}" (${site.id}).`);

  let where = await grepProject(site.id, projectDir());
  add('snippet_in_project', where ? 'ok' : 'warn', where ? `Snippet found in ${where}.` : 'The snippet for this site was not found in this project.', where ? undefined : 'Paste it before </head> in the layout.', where ? undefined : 'sqid snippet');

  add('deployed', site.deployed ? 'ok' : 'warn', site.deployed ? 'Sqid has seen page views from this site.' : 'No page view from this site yet.', site.deployed ? undefined : 'Deploy the snippet, open the site once, then run doctor again.');
  add('connected', site.connected ? 'ok' : 'warn', site.connected ? 'Site is connected.' : 'Site not connected yet (follows the first page view).');

  try{
    let hooks = await api('GET', `/api/sqid/sdks/${site.id}/webhooks`, { flags });
    let list = Array.isArray(hooks) ? hooks : hooks?.webhooks || [];
    let failing = list.filter(h => h.enabled === false || h.health === 'failing' || h.disabled_reason);
    if(!list.length){ add('webhooks', 'warn', 'No webhooks yet; identifications and moments are not being sent anywhere.', 'Add one.', 'sqid webhook add <url> --event identification'); }
    else if(failing.length){ add('webhooks', 'fail', `${failing.length} of ${list.length} webhooks disabled or failing.`, 'Check the endpoint and re-enable.', 'sqid webhook list'); }
    else { add('webhooks', 'ok', `${list.length} webhook${list.length === 1 ? '' : 's'} healthy.`); }
  }catch(error){ add('webhooks', 'warn', `Could not read webhooks (${error.code || error.message}).`); }

  return finish(checks);
}

function finish(checks){
  let failed = checks.filter(c => c.status === 'fail');
  let mark = { ok : 'ok  ', warn : 'warn', fail : 'FAIL' };
  let r = {
    data : { ok : failed.length === 0, checks },
    text : checks.map(c => `${mark[c.status]}  ${c.name.padEnd(20)} ${c.message}${c.fix ? `   -> ${c.fix}` : ''}`).join('\n'),
    next : checks.filter(c => c.fix).slice(0, 3).map(c => ({ command : c.fix, when : c.remedy || c.message }))
  };
  if(failed.length){ process.exitCode = 1; }
  return r;
}
