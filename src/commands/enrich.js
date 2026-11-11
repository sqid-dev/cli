// Enrichment: hand Sqid an email, a phone or a LinkedIn URL and get the person and
// company back. Public API, SDK key (minted once per site by the CLI).

import { usageError, CliError } from '../errors.js';
import { resolveSite } from '../project.js';
import { sdkKeyFor, publicApi } from '../sdkkey.js';

export const help = `Usage: sqid enrich (--email <addr> | --phone <+15551234567> | --linkedin <url>) [--force]

Looks a person up and returns the enriched record (person, company, job, social).
Exactly one of email, phone or linkedin. --force refreshes a record Sqid already holds.
Uses the site's SDK key; the first run creates one named "CLI on <hostname>" (visible
under APIs → SDK keys in the console).
`;

export async function run({ flags }){
  let given = ['email', 'phone', 'linkedin'].filter(k => flags[k]);
  if(given.length !== 1){ throw usageError('enrich takes exactly one of --email, --phone or --linkedin.', [{ command : 'sqid enrich --email jane@acme.com', description : 'By email' }, { command : 'sqid enrich --linkedin https://www.linkedin.com/in/jane-doe', description : 'By LinkedIn profile' }]); }
  let site = await resolveSite(flags);
  let key  = await sdkKeyFor(site, flags);
  let body = { ...(flags.email ? { email : String(flags.email) } : flags.phone ? { phone : String(flags.phone) } : { linkedin_url : String(flags.linkedin) }), ...(flags.force ? { forceUpdate : true } : {}) };
  let r = await publicApi('POST', '/visitors/enrichment', { key, body });
  if(!r.ok){
    let code = r.status === 404 ? 'not_found' : r.status === 402 ? 'out_of_credit' : `http_${r.status}`;
    throw new CliError(code, r.data?.message || r.data?.error || `Enrichment failed (${r.status}).`, r.status === 402 ? 'Top up or raise the plan in the console.' : r.status === 404 ? 'Nothing known for that identifier.' : '', [], undefined);
  }
  return { data : r.data, text : JSON.stringify(r.data, null, 2), next : [{ command : 'sqid visitors list --search <company>', when : 'to see if they have been on the site' }] };
}
