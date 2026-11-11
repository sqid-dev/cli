// The one project file the CLI writes: .sqid.json in the current directory
// (or SQID_PROJECT_DIR). Plus the helpers that read a project: its name, its
// likely public URL, and the install snippet for a site.

import fs from 'node:fs/promises';
import path from 'node:path';
import { api } from './api.js';
import { CliError } from './errors.js';

export const projectDir  = () => process.env.SQID_PROJECT_DIR || process.cwd();
export const projectFile = () => path.join(projectDir(), '.sqid.json');

export async function readProject(){
  try{ return JSON.parse(await fs.readFile(projectFile(), 'utf8')); }
  catch(error){ if(error.code === 'ENOENT'){ return null; } throw error; }
}

export async function writeProject(data){
  await fs.writeFile(projectFile(), JSON.stringify(data, null, 2) + '\n');
  return projectFile();
}

export async function readJson(file){
  try{ return JSON.parse(await fs.readFile(file, 'utf8')); }catch(error){ return null; }
}

// A name for a new site: --name, else package.json "name", else the folder.
export async function guessName(){
  let pkg = await readJson(path.join(projectDir(), 'package.json'));
  let name = pkg?.name ? String(pkg.name).replace(/^@[^/]+\//, '') : path.basename(projectDir());
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 50) || 'My Site';
}

// A public URL for a new site when none is given: package.json "homepage", else common env names.
export async function guessUrl(){
  let pkg = await readJson(path.join(projectDir(), 'package.json'));
  let candidates = [pkg?.homepage, process.env.SQID_SITE_URL, process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.PUBLIC_URL, process.env.SITE_URL, process.env.URL];
  for(let c of candidates){ let o = toOrigins(c); if(o.length){ return o[0]; } }
  return null;
}

// "example.com, https://www.example.com/path" -> ["https://example.com", "https://www.example.com"]
export function toOrigins(input){
  if(!input){ return []; }
  let parts = Array.isArray(input) ? input : String(input).split(/[\s,]+/);
  let out = [];
  for(let p of parts.map(s => s.trim()).filter(Boolean)){
    let s = /^[a-z]+:\/\//i.test(p) ? p : `https://${p}`;
    try{
      let u = new URL(s);
      if(!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') && u.hostname !== 'localhost'){ continue; }
      if(!out.includes(u.origin)){ out.push(u.origin); }
    }catch(error){ /* skip */ }
  }
  return out;
}

// Same template the console shows (Getting started and the SDK page).
export const snippetFor = (sdkId) => `<script>
;(function(squid){
  (window.$quid) || (window.$quid = {});
  document.head.appendChild((function(s){
    s.src='https://app.asksquid.ai/tfs/'+squid+'/sdk';
    s.async=1; return s;
  })(document.createElement('script')));
})('${sdkId}');
</script>`;

// The sites the signed-in person can see (console's own list; same rows as the SDKs page).
export async function listSites(flags){
  let rows = await api('GET', '/api/sqid/projects', { flags });
  return (rows || []).map(siteRow);
}

export function siteRow(p){
  return {
    id        : String(p._id),
    name      : p.name,
    enabled   : p.enabled !== false,
    deployed  : !!p.state?.deployed,
    connected : !!p.state?.connected,
    sandbox   : !!p.sandbox,
    view_only : !!p.view_only,
    owner     : p.owner?.email || null,
    created_at: p.created_at
  };
}

// Which site a command means: --site <id|name>, else .sqid.json, else the only non-sandbox site.
export async function resolveSite(flags){
  let sites = await listSites(flags);
  let want  = flags.site ? String(flags.site) : null;
  if(want){
    let hit = sites.find(s => s.id === want) || sites.find(s => s.name?.toLowerCase() === want.toLowerCase());
    if(!hit){ throw new CliError('site_not_found', `No site "${want}" on this account.`, 'Pick one of the sites below, or create one.', [{ command : 'sqid sites list', description : 'List your sites' }, { command : 'sqid init', description : 'Create a site for this project' }]); }
    return hit;
  }
  let project = await readProject();
  if(project?.site){
    let hit = sites.find(s => s.id === project.site);
    if(hit){ return hit; }
    throw new CliError('project_site_missing', `.sqid.json points at site ${project.site}, which this account cannot see.`, 'Remove .sqid.json and run init again, or pass --site.', [{ command : 'sqid sites list', description : 'List your sites' }]);
  }
  let real = sites.filter(s => !s.sandbox);
  if(real.length === 1){ return real[0]; }
  if(real.length === 0){ throw new CliError('no_site', 'This account has no site yet.', 'Create one for this project.', [{ command : 'sqid init --url https://example.com', description : 'Create the site and get the snippet' }]); }
  throw new CliError('site_ambiguous', `This account has ${real.length} sites and this folder has no .sqid.json.`, 'Say which one.', real.slice(0, 5).map(s => ({ command : `sqid <command> --site ${s.id}`, description : s.name })));
}
