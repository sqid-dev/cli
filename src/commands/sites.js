import { listSites } from '../project.js';
import { usageError } from '../errors.js';

export const help = `sqid sites list

Lists the sites this account can see (id, name, deployed, connected, sandbox).
`;

export async function run({ args, flags }){
  let sub = args[0] || 'list';
  if(sub !== 'list'){ throw usageError(`sites: unknown subcommand "${sub}".`, [{ command : 'sqid sites list', description : 'List your sites' }]); }
  let sites = await listSites(flags);
  return {
    data : sites,
    text : sites.length ? sites.map(s => `${s.id}  ${s.name}${s.sandbox ? '  (sandbox)' : ''}  deployed=${s.deployed} connected=${s.connected}${s.view_only ? '  view-only' : ''}`).join('\n') : 'No sites yet.',
    next : sites.length ? [{ command : 'sqid snippet --site <id>', when : 'to get a site’s install snippet' }] : [{ command : 'sqid init --url https://example.com', when : 'to create the first site' }]
  };
}
