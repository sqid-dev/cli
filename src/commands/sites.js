import { api } from '../api.js';
import { listSites, resolveSite } from '../project.js';
import { CliError, usageError } from '../errors.js';

export const help = `Usage: sqid sites <command>

Commands:
  list                                     The sites this account can see (id, name, deployed, connected, sandbox)
  origins [<site>] [--sandbox]             The addresses the snippet may run on for a site
          [--add <url,...>] [--remove <url,...>] [--set <url,...>]

<site> is a site id or name ("Sandbox" works); --sandbox picks the account's Sandbox.
Without a site, the one from .sqid.json (or the only real site) is used.
Origins are scheme + host + port and must match exactly: http://localhost:3000 and
http://localhost:5173 are two entries. Local hosts keep http://, the rest get https://.
--add and --remove keep every other origin; --set replaces the list (never empty).

Examples:
  sqid sites origins --sandbox --add http://localhost:3000
  sqid sites origins Acme --add www.acme.com
`;

// Local hosts keep http:// (localhost, 127.x, 0.0.0.0, [::1], *.local, *.test, *.localhost); the console uses the same rule.
const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|[^/:]+\.(?:local|test|localhost))(?::\d+)?(?:\/|$)/i;
export function originsFrom(input){
  let parts = (Array.isArray(input) ? input : [input]).flatMap(v => v === true || v == null ? [] : String(v).split(/[\s,]+/)).map(s => s.trim()).filter(Boolean);
  let out = [];
  for(let p of parts){
    let s = /^[a-z]+:\/\//i.test(p) ? p : `${LOCAL.test(p) ? 'http' : 'https'}://${p}`;
    let u; try{ u = new URL(s); }catch(error){ throw usageError(`"${p}" is not a web address.`, [{ command : 'sqid sites origins --sandbox --add http://localhost:3000', description : 'A local dev server' }]); }
    if(!/^https?:$/.test(u.protocol)){ throw usageError(`"${p}" must be http or https.`); }
    if(!out.includes(u.origin)){ out.push(u.origin); }
  }
  return out;
}

// The platform keeps an SDK's origins in its signed config: jwt.site (site origins) and jwt.app (product origins).
export function originsOfJwt(jwt){
  try{
    let payload = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
    let split = (v) => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : [];
    return { site : split(payload.site), app : split(payload.app) };
  }catch(error){ return { site : [], app : [] }; }
}

async function pickSite(name, flags){
  let sites = await listSites(flags);
  if(flags.sandbox){
    let sb = sites.find(s => s.sandbox);
    if(!sb){ throw new CliError('no_sandbox', 'This account has no Sandbox site.', 'Sign in to the console once, or run the Playground, to make it.', [{ command : 'sqid playground', description : 'Uses (and makes) the Sandbox' }]); }
    return sb;
  }
  let want = name || flags.site;
  if(want){
    want = String(want);
    let hit = sites.find(s => s.id === want) || sites.find(s => s.name?.toLowerCase() === want.toLowerCase()) || (want.toLowerCase() === 'sandbox' ? sites.find(s => s.sandbox) : null);
    if(!hit){ throw new CliError('site_not_found', `No site "${want}" on this account.`, 'Pick one of your sites.', [{ command : 'sqid sites list', description : 'List your sites' }]); }
    return hit;
  }
  return resolveSite(flags);
}

export async function run({ args, flags }){
  let sub = args[0] || 'list';
  if(sub === 'list'){
    let sites = await listSites(flags);
    return {
      data : sites,
      text : sites.length ? sites.map(s => `${s.id}  ${s.name}${s.sandbox ? '  (sandbox)' : ''}  deployed=${s.deployed} connected=${s.connected}${s.view_only ? '  view-only' : ''}`).join('\n') : 'No sites yet.',
      next : sites.length ? [{ command : 'sqid snippet --site <id>', when : 'to get a site’s install snippet' }, { command : 'sqid sites origins --sandbox --add http://localhost:3000', when : 'to test on localhost with the Sandbox' }] : [{ command : 'sqid init --url https://example.com', when : 'to create the first site' }]
    };
  }
  if(sub === 'origins'){
    let site = await pickSite(args[1], flags);
    let sdk = await api('GET', `/api/projects/${site.id}`, { flags });
    let now = originsOfJwt(sdk?.jwt);
    let current = now.site.length ? now.site : Array.isArray(sdk?.site_origins) ? sdk.site_origins : [];
    let add = originsFrom(flags.add), remove = originsFrom(flags.remove), set = flags.set != null ? originsFrom(flags.set) : null;
    if(!add.length && !remove.length && !set){
      return { data : { site : { id : site.id, name : site.name, sandbox : site.sandbox }, origins : current }, text : current.length ? `Origins on "${site.name}":\n${current.join('\n')}` : `"${site.name}" has no origins yet.`, next : [{ command : `sqid sites origins ${site.sandbox ? '--sandbox' : site.id} --add http://localhost:3000`, when : 'to allow a local dev server' }] };
    }
    if(set && (add.length || remove.length)){ throw usageError('Use --set on its own, or --add/--remove.'); }
    const apply = (list) => set ? [...set] : [...list.filter(o => !remove.includes(o)), ...add.filter(o => !list.includes(o))];
    let next = apply(current);
    if(!next.length){ throw usageError('A site needs at least one origin; this would leave none.', [{ command : `sqid sites origins ${site.id} --set https://example.com`, description : 'Replace the list' }]); }
    // Product origins (jwt.app) are re-signed from the same PATCH; carry them along with the same change so none are lost.
    let product = now.app.length ? apply(now.app) : next;
    if(!product.length){ product = next; }
    await api('PATCH', `/api/projects/${site.id}`, { flags, body : { site_origins : next, product_origins : product } });
    return {
      data : { site : { id : site.id, name : site.name, sandbox : site.sandbox }, origins : next, added : next.filter(o => !current.includes(o)), removed : current.filter(o => !next.includes(o)) },
      text : `Origins on "${site.name}":\n${next.join('\n')}`,
      next : [{ command : `sqid snippet --site ${site.id}`, when : 'to paste the snippet into the page on that origin' }]
    };
  }
  throw usageError(`sites: unknown subcommand "${sub}".`, [{ command : 'sqid sites list', description : 'List your sites' }, { command : 'sqid sites origins --sandbox --add http://localhost:3000', description : 'Allow localhost on the Sandbox' }]);
}
