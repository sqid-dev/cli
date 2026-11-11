// SDK keys for the site (the public /visitors/* API). Account keys come later.

import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { resolveSite } from '../project.js';

export const help = `Usage: sqid keys <command>

SDK keys for the site: what a backend uses to read or enrich this site's visitors
through the REST API (https://docs.sqid.dev/api-reference).

Commands:
  list                         Keys on the site (values shown; keep them server-side)
  create [--name <name>]       New key
  delete <id> --yes            Remove a key
`;

const row = (t) => ({ id : String(t._id || t.id), name : t.name || null, key : t.jwt, created_at : t.created_at || null });

export async function run({ args, flags, mode }){
  let [sub, id] = args;
  let site = await resolveSite(flags);
  if(!sub || sub === 'list'){
    let r = await api('GET', `/api/sdks/${site.id}/tokens`, { flags });
    let rows = (Array.isArray(r) ? r : r?.tokens || []).map(row);
    return { data : rows, text : rows.length ? rows.map(k => `${k.id}  ${(k.name || 'Unnamed key').padEnd(24)}  ${k.key}`).join('\n') : 'No SDK keys yet.', next : [{ command : 'sqid keys create --name Production', when : 'to make one for a backend' }] };
  }
  if(sub === 'create'){
    let r = await api('POST', `/api/sdks/${site.id}/tokens`, { flags, body : { name : flags.name ? String(flags.name).slice(0, 60) : undefined } });
    let k = row(r);
    return { data : k, text : `${k.name || 'Key'}: ${k.key}\nUse it server-side only: Authorization: Bearer <key> against https://app.asksquid.ai/api/v1/visitors/...`, next : [{ command : 'sqid enrich --email <addr>', when : 'to try the visitor API from here' }] };
  }
  if(sub === 'delete'){
    if(!id){ throw usageError('keys delete needs the key id.', [{ command : 'sqid keys list', description : 'Find it' }]); }
    if(mode === 'agent' && !flags.yes){ throw new CliError('confirm_required', `delete revokes key ${id}; anything using it stops working.`, 'Pass --yes to confirm.', [{ command : `sqid keys delete ${id} --yes`, description : 'Revoke it' }], undefined, 2); }
    await api('DELETE', `/api/sdks/${site.id}/tokens/${id}`, { flags });
    return { data : { deleted : true, id }, text : `Key ${id} revoked.` };
  }
  throw usageError(`keys: unknown subcommand "${sub}".`, [{ command : 'sqid keys list', description : 'Keys on the site' }]);
}
