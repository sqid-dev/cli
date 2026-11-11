import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { readProject, writeProject, guessName, guessUrl, toOrigins, snippetFor, listSites } from '../project.js';

export const help = `sqid init [--name <site name>] [--url <https://example.com[,https://www.example.com]>] [--yes]

Creates a site for this project, writes .sqid.json next to your package.json,
and prints the install snippet. If the account has no plan yet, starts the free
Developer plan first (no card). Re-running in a folder that already has
.sqid.json just prints that site's snippet again.

  --name   Site name (default: package.json name, else the folder name)
  --url    Public URL(s) the snippet will run on (default: package.json homepage or SITE_URL-style env vars)
  --yes    Create even when a site with the same name already exists (otherwise that site is reused)
`;

export async function run({ args, flags, mode }){
  let existing = await readProject();
  if(existing?.site){
    return done(existing.site, existing.name, existing.origins || [], 'already_initialised');
  }

  let name    = flags.name ? String(flags.name).trim().slice(0, 50) : await guessName();
  let origins = toOrigins(flags.url || args[0] || await guessUrl());
  if(!origins.length){
    throw usageError('A public URL is needed for the site (the snippet only runs on its own origins).', [
      { command : `sqid init --url https://example.com`, description : 'Create the site for that origin' },
      { command : `sqid init --url https://example.com,https://www.example.com --name "${name}"`, description : 'Several origins and an explicit name' }
    ]);
  }

  let me = await api('GET', '/api/sqid/me', { flags });
  let started = null;
  if(!me.account?.hasSubscription){
    // Start free: Developer plan, $0, no card. The same thing the console's first screen does.
    try{ started = await api('POST', '/api/sqid/billing/start', { flags, body : {} }); }
    catch(error){
      throw new CliError('plan_required', `This account has no plan yet and the free Developer plan could not be started (${error.code || error.message}).`, 'Start it in the console once; after that the CLI can create sites.', [{ command : 'open https://app.sqid.dev', description : 'Console (Start free)' }], error);
    }
  }

  // Reuse an existing site of the same name unless told to create another.
  let sites = await listSites(flags);
  let same  = sites.find(s => !s.sandbox && s.name?.toLowerCase() === name.toLowerCase());
  if(same && !flags.yes){
    return done(same.id, same.name, origins, 'reused_existing', { note : `A site named "${name}" already existed; reusing it. Pass --yes to create another.` , started });
  }

  let created;
  try{
    created = await api('POST', '/api/projects', { flags, body : { name, site_origins : origins, product_origins : origins, avatar_index : 1 } });
  }catch(error){
    if(error.code === 'site_limit'){ throw new CliError('site_limit', 'This plan has reached its site limit.', 'Delete a site you no longer use, or upgrade.', [{ command : 'sqid sites list', description : 'See your sites' }, { command : 'sqid plan set oem', description : 'Move to the OEM plan' }], error); }
    throw error;
  }
  let id = String(created?._id || created?.id || created?.sdk_id || '');
  if(!id){ throw new CliError('create_failed', 'Sqid created the site but returned no id.', 'Run `sqid sites list` and write the id into .sqid.json as "site".'); }
  return done(id, name, origins, 'created', { started });
}

async function done(id, name, origins, status, extra = {}){
  let file = await writeProject({ site : id, name, origins, created_at : new Date().toISOString() });
  let snippet = snippetFor(id);
  return {
    data : { status, site : { id, name, origins }, project_file : file, plan_started : extra.started ? extra.started.plan : undefined, snippet, note : extra.note },
    text : [
      status === 'created' ? `Created site "${name}" (${id}) for ${origins.join(', ')}.` : status === 'reused_existing' ? extra.note : `This folder is already set up for site "${name}" (${id}).`,
      extra.started ? `Started the free Developer plan.` : null,
      `Wrote ${file}.`,
      '',
      'Paste this before </head> on every page:',
      snippet
    ].filter(x => x !== null).join('\n'),
    next : [
      { command : 'sqid doctor',                                   when : 'after the snippet is in the layout and deployed' },
      { command : 'sqid webhook add <url> --event identification', when : 'to receive each identified visitor as a webhook' },
      { command : 'sqid webhook add <url> --event moment',         when : 'to send visitor moments to your agent' }
    ]
  };
}
