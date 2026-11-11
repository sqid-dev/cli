// Who has been on the site. Reads the console's own lists with the OAuth token.

import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { resolveSite, listSites } from '../project.js';

export const help = `Usage: sqid visitors <command>

Identified visitors on the site (the console's Identities list), newest first.

Commands:
  list [--search <text>] [--all-sites] [--before <ms>]   Identified visitors (25 per page; "next" carries the cursor)
  get <visitor_id>                                        The full profile
  journey <visitor_id> [--limit <n>]                      Pages and events in order
  key-events <visitor_id>                                 Key events (forms, high-intent pages)
  scores <visitor_id>                                     Lead scores

--search matches the start of a first name, last name, company or email (3+ characters).
Visitor ids are the same ids webhooks carry as visitor.id.
`;

function row(p, siteNames){
  let u = p.user || {};
  return {
    id : String(p._id), name : u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || null,
    email : u.email || null, phone : u.phone || null, company : u.company || null, title : u.company_role || null,
    linkedin : u.linkedin_url || null, location : p.browser?.location ? [p.browser.location.city, p.browser.location.region, p.browser.location.country].filter(Boolean).join(', ') : null,
    site : siteNames[String(p.sdk_id)] || String(p.sdk_id), site_id : String(p.sdk_id),
    first_seen : p.created_at || null, last_seen : p.last_seen_at || null
  };
}

export async function run({ args, flags }){
  let [sub, id] = args;
  if(!sub || sub === 'list'){
    let sites = await listSites(flags);
    let names = Object.fromEntries(sites.map(s => [s.id, s.name]));
    let q = new URLSearchParams();
    if(!flags['all-sites']){ let site = await resolveSite(flags); q.set('sdk', site.id); }
    if(flags.search){ if(String(flags.search).trim().length < 3){ throw usageError('--search needs at least 3 characters.'); } q.set('q', String(flags.search)); }
    if(flags.before){ q.set('before', String(flags.before)); if(flags.seen){ q.set('seen', String(flags.seen)); } }
    let r = await api('GET', `/api/sqid/identities?${q}`, { flags });
    let rows = (r?.identities || []).map(p => row(p, names));
    return {
      data : { visitors : rows, next_cursor : r?.next || null },
      text : rows.length ? rows.map(v => `${v.id}  ${(v.name || '-').padEnd(24)}  ${(v.email || '-').padEnd(30)}  ${v.company || '-'}  ${v.last_seen || ''}`).join('\n') : 'No identified visitors yet.',
      next : [
        ...(r?.next ? [{ command : `sqid visitors list --before ${r.next.before} --seen ${r.next.seen.join(',')}`, when : 'for the next page' }] : []),
        ...(rows[0] ? [{ command : `sqid visitors get ${rows[0].id}`, when : 'for the full profile' }] : [{ command : 'sqid webhook add https://<your-app>/api/visitors', when : 'to be told as each visitor is identified' }])
      ]
    };
  }

  const SUB = { get : '', journey : '/journey', 'key-events' : '/key_events', scores : '/lead_scores' };
  if(!(sub in SUB)){ throw usageError(`visitors: unknown subcommand "${sub}".`, [{ command : 'sqid visitors list', description : 'Identified visitors' }]); }
  if(!id){ throw usageError(`visitors ${sub} needs a visitor id.`, [{ command : 'sqid visitors list', description : 'Find ids' }]); }
  let site = await resolveSite(flags);
  let q = sub === 'journey' ? `?limit=${Math.min(parseInt(flags.limit, 10) || 50, 200)}&skip=0` : '';
  let r;
  try{ r = await api('GET', `/api/projects/${site.id}/profiles/${id}${SUB[sub]}${q}`, { flags }); }
  catch(error){ if(error.code === 'http_404' || error.code === 'not_found'){ throw new CliError('visitor_not_found', `No visitor ${id} on site "${site.name}".`, 'Check the id, or pass --site if the visitor belongs to another site.', [{ command : 'sqid visitors list --all-sites', description : 'Across every site' }], error); } throw error; }
  return { data : r, text : JSON.stringify(r, null, 2), next : sub === 'get' ? [{ command : `sqid visitors journey ${id}`, when : 'to see what they did' }] : [] };
}
