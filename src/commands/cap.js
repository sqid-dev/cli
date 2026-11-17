// Identification cap per site: stop identifying after n this period, or no cap.
import { api } from '../api.js';
import { usageError } from '../errors.js';
import { resolveSite } from '../project.js';

export const help = `Usage: sqid cap set <n> | sqid cap off | sqid cap show

A monthly ceiling on identifications for the site (spend control). off removes it.
`;

export async function run({ args, flags }){
  let [sub, n] = args;
  let site = await resolveSite(flags);
  if(!sub || sub === 'show'){
    // /api/sqid/limits: { sdks:[{ id, name, enabled, events:{ used, cap }, visitorID:{ used, cap } }] }; cap null = no cap.
    let r = await api('GET', '/api/sqid/limits', { flags });
    let row = (r?.sdks || []).find(s => s.id === site.id);
    let vid = row?.visitorID || { used : null, cap : null };
    return {
      data : { site : { id : site.id, name : site.name }, cap : vid.cap ?? null, used : vid.used ?? null },
      text : `Cap on "${site.name}": ${vid.cap == null ? 'none' : `${vid.cap} identifications`}${vid.used != null ? ` (${vid.used} used this period)` : ''}`,
      next : vid.cap == null ? [{ command : 'sqid cap set 5000', when : 'to stop identifying after 5000 this period' }] : [{ command : 'sqid cap off', when : 'to remove the cap' }]
    };
  }
  let body;
  if(sub === 'off'){ body = { cap : null }; }
  else if(sub === 'set'){ let v = Number(n); if(!Number.isInteger(v) || v < 0){ throw usageError('cap set needs a whole number.', [{ command : 'sqid cap set 5000', description : 'At most 5000 identifications this period' }]); } body = { cap : v }; }
  else { throw usageError(`cap: unknown subcommand "${sub}".`, [{ command : 'sqid cap set 5000', description : 'Set a cap' }, { command : 'sqid cap off', description : 'Remove it' }]); }
  let r = await api('PATCH', `/api/sqid/sdks/${site.id}/cap`, { flags, body });
  return { data : { site : { id : site.id, name : site.name }, cap : body.cap, result : r }, text : body.cap === null ? `Cap removed on "${site.name}".` : `Cap on "${site.name}": ${body.cap} identifications.` };
}
