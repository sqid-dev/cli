// Webhooks: where Sqid sends what it learns. The first thing most people want is
// de-anonymisation, so `webhook add <url>` defaults to the identification event
// (the full v2 record). Moments, site visits by identified visitors and labelled clicks are the other events.
//
// Writes go through the console's own routes with the OAuth token (v2 events
// have their own base path); reads come from /api/sqid/... which never returns
// passwords.

import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { resolveSite } from '../project.js';

export const EVENTS = {
  identification      : { namespace : 'visitor.identification.created.v2', v2 : true,  label : 'Visitor identified',       help : 'A visitor is identified. Sends the full record: person, company, job, location, social, device.' },
  moment              : { namespace : 'visitor.moment.created.v2',         v2 : true,  label : 'Intent moment',            help : 'A Signals moment is decided for a visitor: kind, decision (engage, wait, quiet), why, page, session.' },
  page                : { namespace : 'visitor.connection.event',          v2 : false, label : 'Visitor connected',        help : 'An identified visitor opens your site (page, location, device).' },
  click               : { namespace : 'visitor.click.event',               v2 : false, label : 'Visitor clicked',          help : 'An identified visitor clicks an element labelled as a key event or a conversion.' },
  'identification-v1' : { namespace : 'visitor.identification.created',    v2 : false, label : 'Visitor identified (v1)',  help : 'The older, section-based identification payload.' }
};
const BY_NAMESPACE = Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [e.namespace, { key : k, ...e }]));

// Default payload sections for v1 events (same defaults as the console).
const SECTIONS = {
  'visitor.identification.created' : { context : false, traits : true, social : true, company : true, job : true, location : false, experience : false },
  'visitor.connection.event'       : { context : true, location : true, device : true, traits : false, social : false },
  'visitor.click.event'            : { context : true, details : true, element : true, traits : false, social : false }
};
const WITH_EXTRA = ['traits', 'social', 'company'];
const settingsFor = (ns) => Object.fromEntries(Object.entries(SECTIONS[ns] || {}).map(([k, on]) => [k, WITH_EXTRA.includes(k) ? { enabled : on, extra : {} } : { enabled : on }]));

export const help = `Usage: sqid webhook <command>

Where Sqid sends what it learns about your visitors.

Commands:
  add <url> [--event <event>] [--name <name>] [--auth user:pass]   Create an endpoint (default event: identification)
  list                                                             Endpoints on the site, with health
  get <id>                                                         One endpoint
  preview [--event <event>]                                        A sample payload for an event (nothing is sent)
  test <id>                                                        Send a sample delivery now and show the response
  enable <id> | disable <id>                                       Turn an endpoint on or off
  deliveries <id> [--failed] [--limit <n>]                         Recent deliveries (request and response)
  retry <id> <event_id>                                            Re-send one delivery
  delete <id> --yes                                                Remove an endpoint

Events:
  identification   ${EVENTS.identification.help}
  moment           ${EVENTS.moment.help}
  page             ${EVENTS.page.help}
  click            ${EVENTS.click.help}

Endpoints must be public https URLs. Use --auth for HTTP basic auth on deliveries.
`;

const base = (site, ev) => `${ev.v2 ? '/api/v2' : '/api'}/projects/${site.id}`;

function eventFor(flag){
  let key = String(flag || 'identification').toLowerCase();
  if(!EVENTS[key]){ throw usageError(`Unknown event "${flag}".`, Object.keys(EVENTS).filter(k => k !== 'identification-v1').map(k => ({ command : `sqid webhook add <url> --event ${k}`, description : EVENTS[k].label }))); }
  return { key, ...EVENTS[key] };
}

function row(w){
  let ev = BY_NAMESPACE[w.namespace];
  return {
    id : w.id, name : w.name, event : ev?.key || w.namespace, namespace : w.namespace, url : w.url, enabled : w.enabled,
    auth : w.auth ? w.auth.username : null,
    health : w.health?.status || 'unknown', consecutive_fails : w.health?.consecutiveFails || 0, last_status : w.health?.lastStatus ?? null, last_at : w.health?.lastAt || null,
    totals : w.totals, last24h : w.last24h, created_at : w.created_at
  };
}

async function find(site, id, flags){
  let hooks = await api('GET', `/api/sqid/sdks/${site.id}/webhooks`, { flags });
  let list = Array.isArray(hooks) ? hooks : hooks?.webhooks || [];
  let w = list.find(h => h.id === id) || list.find(h => h.name === id);
  if(!w){ throw new CliError('webhook_not_found', `No webhook "${id}" on site "${site.name}".`, 'List them to find the id.', [{ command : `sqid webhook list --site ${site.id}`, description : 'Endpoints on this site' }]); }
  return { w, ev : BY_NAMESPACE[w.namespace] || { v2 : /\.v2$/.test(w.namespace) } };
}

export async function run({ args, flags, mode }){
  let [sub, ...rest] = args;
  if(!sub){ throw usageError('webhook: say what to do.', [{ command : 'sqid webhook add https://example.com/api/visitors', description : 'Receive each identified visitor' }, { command : 'sqid webhook list', description : 'Endpoints on the site' }]); }
  let site = await resolveSite(flags);

  if(sub === 'add'){
    let url = rest[0] || flags.url;
    if(!url || !/^https:\/\//i.test(url)){ throw usageError('webhook add needs a public https URL.', [{ command : 'sqid webhook add https://example.com/api/visitors', description : 'Identification (default)' }, { command : 'sqid webhook add https://example.com/api/moments --event moment', description : 'Moments' }]); }
    let ev = eventFor(flags.event);
    let auth = null;
    if(flags.auth){ let [u, ...p] = String(flags.auth).split(':'); if(!u || !p.length){ throw usageError('--auth must be user:password.'); } auth = { username : u, password : p.join(':') }; }
    let name = flags.name ? String(flags.name).slice(0, 60) : (() => { try{ let u = new URL(url); return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 60); }catch(e){ return 'CLI webhook'; } })();
    let body = { name, namespace : ev.namespace, frequency : 'all_time', enabled : flags.enable !== false, source : ev.v2 ? { webhook_url : url, auth } : { webhook_url : url, settings : settingsFor(ev.namespace), auth } };
    let created;
    try{ created = await api('POST', `${base(site, ev)}/webhook`, { flags, body }); }
    catch(error){
      if(error.code === 'invalid_webhook_url'){ throw new CliError('invalid_webhook_url', 'Sqid refused the URL: it must be public https (no localhost or private addresses).', 'Expose your handler with a public URL, or test with `sqid webhook preview` first.', [{ command : `sqid webhook preview --event ${ev.key}`, description : 'See the payload without an endpoint' }], error); }
      throw error;
    }
    let id = created?.id || created?._id || created?.webhook?._id || created?.webhook?.id || null;
    return {
      data : { created : true, id : id ? String(id) : null, name, event : ev.key, namespace : ev.namespace, url, site : { id : site.id, name : site.name } },
      text : `Webhook wired → ${url}  (${ev.label}, site "${site.name}")`,
      next : [
        { command : `sqid webhook test ${id || '<id>'}`,     when : 'to send a sample delivery to your handler now' },
        { command : `sqid webhook preview --event ${ev.key}`, when : 'to see the exact payload shape while writing the handler' },
        { command : 'sqid doctor',                            when : 'to confirm the stream is live' }
      ]
    };
  }

  if(sub === 'list'){
    let hooks = await api('GET', `/api/sqid/sdks/${site.id}/webhooks`, { flags });
    let list = (Array.isArray(hooks) ? hooks : hooks?.webhooks || []).map(row);
    return {
      data : list,
      text : list.length ? list.map(w => `${w.id}  ${w.enabled ? 'on ' : 'off'}  ${w.event.padEnd(14)}  ${w.health.padEnd(13)}  ${w.url}`).join('\n') : `No webhooks on "${site.name}" yet.`,
      next : list.length ? [{ command : 'sqid webhook deliveries <id> --failed', when : 'to inspect failures' }] : [{ command : 'sqid webhook add https://example.com/api/visitors', when : 'to receive each identified visitor' }]
    };
  }

  if(sub === 'get'){
    let { w } = await find(site, rest[0], flags);
    return { data : row(w), text : (d) => JSON.stringify(d, null, 2) };
  }

  if(sub === 'preview'){
    let ev = eventFor(flags.event);
    let sample = await api('POST', `${base(site, ev)}/webhook/preview`, { flags, body : ev.v2 ? { namespace : ev.namespace } : { namespace : ev.namespace, source : { settings : settingsFor(ev.namespace) } } });
    return { data : { event : ev.key, namespace : ev.namespace, payload : sample }, text : JSON.stringify(sample, null, 2), next : [{ command : `sqid webhook add <url> --event ${ev.key}`, when : 'once your handler accepts this shape' }] };
  }

  if(sub === 'test'){
    let { w, ev } = await find(site, rest[0], flags);
    let r = await api('POST', `${base(site, ev)}/webhook/test`, { flags, body : { webhook_id : w.id } });
    let ok = !!r?.response?.success;
    return {
      data : { delivered : ok, status : r?.response?.status ?? null, request : r?.request?.payload, response : r?.response?.data },
      text : `${ok ? 'Delivered' : 'Failed'}${r?.response?.status ? ` · HTTP ${r.response.status}` : ' · no response'}\n${typeof r?.response?.data === 'string' ? r.response.data.slice(0, 500) : JSON.stringify(r?.response?.data ?? null, null, 2)}`,
      next : ok ? [{ command : 'sqid doctor', when : 'to confirm the stream is live' }] : [{ command : `sqid webhook deliveries ${w.id} --failed`, when : 'to see what your endpoint returned' }]
    };
  }

  if(sub === 'enable' || sub === 'disable'){
    let { w, ev } = await find(site, rest[0], flags);
    await api('PATCH', `${base(site, ev)}/webhook/${w.id}`, { flags, body : { enabled : sub === 'enable' } });
    return { data : { id : w.id, enabled : sub === 'enable' }, text : `${w.name} ${sub}d.` };
  }

  if(sub === 'deliveries'){
    let { w } = await find(site, rest[0], flags);
    let q = new URLSearchParams({ limit : String(Math.min(parseInt(flags.limit, 10) || 25, 50)), ...(flags.failed ? { status : 'failed' } : {}) });
    let r = await api('GET', `/api/sqid/sdks/${site.id}/webhooks/${w.id}/events?${q}`, { flags });
    let events = (r?.events || []).map(e => ({ id : String(e._id || e.id), at : e.created_at, success : !!e.response?.success, status : e.response?.status ?? null, request : e.request?.payload, response : e.response?.data }));
    return {
      data : { total : r?.total ?? events.length, totals : r?.totals, events },
      text : events.length ? events.map(e => `${e.id}  ${e.success ? 'ok  ' : 'FAIL'}  ${e.status ?? '-'}  ${e.at}`).join('\n') : 'No deliveries yet.',
      next : events.some(e => !e.success) ? [{ command : `sqid webhook retry ${w.id} <event_id>`, when : 'after fixing the endpoint' }] : []
    };
  }

  if(sub === 'retry'){
    let { w, ev } = await find(site, rest[0], flags);
    if(!rest[1]){ throw usageError('retry needs the delivery id.', [{ command : `sqid webhook deliveries ${w.id} --failed`, description : 'Find the delivery id' }]); }
    let r = await api('POST', `${base(site, ev)}/webhook/${w.id}/event/${rest[1]}/retry`, { flags, body : {} });
    return { data : { retried : true, result : r }, text : 'Retried.' };
  }

  if(sub === 'delete'){
    let { w, ev } = await find(site, rest[0], flags);
    if(mode === 'agent' && !flags.yes){ throw new CliError('confirm_required', `delete removes webhook "${w.name}" and its delivery history.`, 'Pass --yes to confirm.', [{ command : `sqid webhook delete ${w.id} --yes`, description : 'Delete it' }], undefined, 2); }
    await api('DELETE', `${base(site, ev)}/webhook/${w.id}`, { flags });
    return { data : { deleted : true, id : w.id }, text : `${w.name} deleted.` };
  }

  throw usageError(`webhook: unknown subcommand "${sub}".`, [{ command : 'sqid webhook --help', description : 'Subcommands' }]);
}
