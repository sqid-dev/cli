// Signals per site: on, off, status. Moments only exist while Signals is on.
import { api } from '../api.js';
import { usageError, CliError } from '../errors.js';
import { resolveSite } from '../project.js';

export const help = `Usage: sqid signals <on|off|status>

Signals watches behaviour on the site and emits moments (see sqid moments, and
webhook --event moment). Per site. On also starts variant-picker tracking in the
SDK (sizes, colors, plans), which feeds the choosing_options moment. An admin lock
or the account's allowance can override the switch; status shows the effective state.
`;

export async function run({ args, flags }){
  let sub = args[0] || 'status';
  let site = await resolveSite(flags);
  if(sub === 'status'){
    let s = await api('GET', '/api/sqid/signals/settings', { flags });
    let mine = (s?.sdks || []).find(x => String(x.id || x.sdk_id || x._id) === site.id) || null;
    let data = { site : { id : site.id, name : site.name }, site_setting : mine, account : s?.account || null, allowance : s?.allowance || null };
    return { data, text : `Signals on "${site.name}": ${mine ? (mine.effective || mine.state || (mine.enabled ? 'on' : 'off')) : 'off (never enabled)'}${s?.account?.locked ? '  (locked by admin at account level)' : ''}${s?.allowance ? `\nAllowance: ${JSON.stringify(s.allowance)}` : ''}`, next : [{ command : mine?.enabled ? 'sqid moments list' : 'sqid signals on', when : mine?.enabled ? 'to see moments' : 'to start producing moments' }] };
  }
  if(sub !== 'on' && sub !== 'off'){ throw usageError(`signals: unknown subcommand "${sub}".`, [{ command : 'sqid signals on', description : 'Turn Signals on for the site' }]); }
  try{
    let r = await api('PATCH', `/api/sqid/sdks/${site.id}/signals`, { flags, body : { enabled : sub === 'on' } });
    return { data : { site : { id : site.id, name : site.name }, enabled : sub === 'on', result : r }, text : `Signals ${sub} for "${site.name}".`, next : sub === 'on' ? [{ command : 'sqid webhook add https://<your-app>/api/moments --event moment', when : 'to receive moments' }, { command : 'sqid moments list', when : 'to see them here' }] : [] };
  }catch(error){
    if(error.code === 'locked_by_admin'){ throw new CliError('locked_by_admin', 'Signals for this site is locked by a Sqid admin.', 'Contact support to change it.', [], error); }
    throw error;
  }
}
