// Moments: what Signals decided about visitors. list, get, tail (SSE).
import { api, accessToken } from '../api.js';
import { usageError } from '../errors.js';
import { resolveSite } from '../project.js';
import { API_ORIGIN } from '../meta.js';

export const help = `Usage: sqid moments <command>

Commands:
  list [--decision engage|wait|quiet] [--kind <kind|group>] [--all-sites] [--limit <n>] [--before <ms> --seen <ids>]
  get <id>
  tail [--decision engage]        Follow new moments as they arrive (NDJSON in agent mode)

Kinds: deliberation, high_intent_page, choosing_options, discount_codes, cart_stall,
       struggle, form_stall, churn_shape, settled_attention, other.
Groups: buying, friction, churn, attention, other.
`;

function qs(flags, site){
  let q = new URLSearchParams();
  if(site){ q.set('sdk', site.id); }
  if(flags.decision){ q.set('decision', String(flags.decision)); }
  if(flags.kind){ q.set('kind', String(flags.kind)); }
  if(flags.limit){ q.set('limit', String(Math.min(parseInt(flags.limit, 10) || 25, 50))); }
  if(flags.before){ q.set('before', String(flags.before)); if(flags.seen){ q.set('seen', String(flags.seen)); } }
  return q;
}

export async function run({ args, flags, mode, out }){
  let [sub, id] = args;
  sub = sub || 'list';
  let site = flags['all-sites'] ? null : await resolveSite(flags);

  if(sub === 'list'){
    let r = await api('GET', `/api/sqid/moments?${qs(flags, site)}`, { flags });
    let rows = r?.events || [];
    return {
      data : { moments : rows, next_cursor : r?.next || null, kinds : r?.kinds },
      text : rows.length ? rows.map(m => `${m.id || m._id}  ${String(m.decision?.action || m.action || '').padEnd(6)}  ${String(m.kind || '').padEnd(16)}  ${m.page || ''}  ${m.person?.name || m.profile?.name || ''}`).join('\n') : 'No moments yet.',
      next : [...(r?.next ? [{ command : `sqid moments list --before ${r.next.before} --seen ${r.next.seen.join(',')}`, when : 'next page' }] : []), ...(rows.length ? [] : [{ command : 'sqid signals status', when : 'to check Signals is on for the site' }])]
    };
  }
  if(sub === 'get'){
    if(!id){ throw usageError('moments get needs an id.', [{ command : 'sqid moments list', description : 'Find one' }]); }
    let r = await api('GET', `/api/sqid/moments/${encodeURIComponent(id)}`, { flags });
    return { data : r, text : JSON.stringify(r, null, 2) };
  }
  if(sub === 'tail'){
    let creds = await accessToken();
    let origin = flags.api || API_ORIGIN;
    let ctrl = new AbortController();
    process.on('SIGINT', () => { ctrl.abort(); process.exit(0); });
    out.note(`Following moments${site ? ` on "${site.name}"` : ''}. Ctrl-C to stop.`);
    let res = await fetch(`${origin}/api/sqid/moments/live?${qs(flags, site)}`, { headers : { authorization : `Bearer ${creds.access_token}`, accept : 'text/event-stream' }, signal : ctrl.signal });
    if(!res.ok || !res.body){ throw usageError(`live feed answered ${res.status}.`); }
    let buf = '';
    for await (let chunk of res.body){
      buf += Buffer.from(chunk).toString('utf8');
      let parts = buf.split('\n\n'); buf = parts.pop();
      for(let p of parts){
        let line = p.split('\n').find(l => l.startsWith('data: '));
        if(!line){ continue; }
        let obj; try{ obj = JSON.parse(line.slice(6)); }catch(e){ continue; }
        // The feed says "n new" (and may carry events); fetch the newest page when it only counts.
        let events = obj.events || (obj.event ? [obj.event] : null);
        if(!events){ let r = await api('GET', `/api/sqid/moments?${qs({ ...flags, limit : obj.n || 5 }, site)}`, { flags }); events = r?.events || []; }
        for(let m of events){ process.stdout.write((mode === 'agent' ? JSON.stringify(m) : `${m.decision?.action || ''}  ${m.kind || ''}  ${m.page || ''}  ${m.person?.name || ''}`) + '\n'); }
      }
    }
    return null;
  }
  throw usageError(`moments: unknown subcommand "${sub}".`, [{ command : 'sqid moments list', description : 'Recent moments' }]);
}
