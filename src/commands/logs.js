// Logs: API calls made with the account's keys, and webhook deliveries across the site.
import { api } from '../api.js';
import { usageError } from '../errors.js';
import { resolveSite } from '../project.js';

export const help = `Usage: sqid logs <api|webhooks> [--failed] [--endpoint <path>] [--limit <n>] [--before <ms> --seen <ids>]

api        Calls made to the REST API with this account's keys (newest first)
webhooks   Deliveries across the site's endpoints (newest first)
`;

function cursor(flags){ let q = new URLSearchParams(); if(flags.limit){ q.set('limit', String(Math.min(parseInt(flags.limit, 10) || 25, 50))); } if(flags.before){ q.set('before', String(flags.before)); if(flags.seen){ q.set('seen', String(flags.seen)); } } if(flags.failed){ q.set('status', 'failed'); } return q; }
const nextOf = (cmd, r) => r?.next ? [{ command : `${cmd} --before ${r.next.before} --seen ${r.next.seen.join(',')}`, when : 'next page' }] : [];

export async function run({ args, flags }){
  let kind = args[0];
  if(kind === 'api'){
    let q = cursor(flags); if(flags.endpoint){ q.set('endpoint', String(flags.endpoint)); }
    let r = await api('GET', `/api/sqid/api-logs?${q}`, { flags });
    let rows = r?.events || [];
    return { data : { events : rows, endpoints : r?.endpoints, keys : r?.keys, next_cursor : r?.next || null }, text : rows.length ? rows.map(e => `${e.id || e._id}  ${e.success === false || e.response?.success === false ? 'FAIL' : 'ok  '}  ${e.status ?? e.response?.status ?? ''}  ${e.endpoint || ''}  ${e.created_at || ''}`).join('\n') : 'No API calls logged.', next : nextOf('sqid logs api', r) };
  }
  if(kind === 'webhooks'){
    let site = await resolveSite(flags);
    let r = await api('GET', `/api/sqid/sdks/${site.id}/webhook-events?${cursor(flags)}`, { flags });
    let rows = r?.events || [];
    return { data : { events : rows, endpoints : r?.endpoints, next_cursor : r?.next || null }, text : rows.length ? rows.map(e => `${e._id || e.id}  ${e.response?.success ? 'ok  ' : 'FAIL'}  ${e.response?.status ?? '-'}  ${e.endpoint?.name || e.notification || ''}  ${e.created_at || ''}`).join('\n') : 'No deliveries yet.', next : nextOf(`sqid logs webhooks --site ${site.id}`, r) };
  }
  throw usageError('logs api|webhooks', [{ command : 'sqid logs api --failed', description : 'Failed API calls' }, { command : 'sqid logs webhooks --failed', description : 'Failed deliveries' }]);
}
