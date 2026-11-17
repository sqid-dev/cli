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

// The public API's refusals, by the reason it sends (plain text on a 400).
const REASONS = [
  [/not enough credits/i,            'out_of_credit',  'The account has no credits left.', [{ command : 'sqid billing status', description : 'See credits' }, { command : 'sqid billing topup 20', description : 'Developer: add 80 credits' }]],
  [/sandbox/i,                       'sandbox_refused', 'Enrichment is refused on the Sandbox site. Use a real site.', [{ command : 'sqid sites list', description : 'Pick a real site, then pass --site' }]],
  [/^vid off$/i,                     'vid_off',        'Identification is switched off for this site. Ask Sqid support.', []],
  [/reached custom limit/i,          'cap_reached',    'The site reached its identification cap.', [{ command : 'sqid cap show', description : 'See the cap' }, { command : 'sqid cap off', description : 'Remove it' }]],
  [/inactive subscription/i,         'inactive_plan',  'The account has no active plan.', [{ command : 'sqid billing status', description : 'See the plan' }]],
  [/invalid (email|phone|linkedin)/i, 'invalid_input',  'Check the identifier and try again.', []]
];
export function enrichError(r, site){
  let reason = (r.data && typeof r.data === 'object' ? r.data.message || r.data.error : null) || String(r.text || '').trim().slice(0, 300) || `Enrichment failed (${r.status}).`;
  if(r.status === 429){ return new CliError('rate_limited', reason, 'Wait a moment and try again.', []); }
  if(r.status === 401 || r.status === 403){ return new CliError('key_refused', reason, 'The saved SDK key was refused; mint a new one.', [{ command : `sqid keys list --site ${site.id}`, description : 'SDK keys for the site' }]); }
  let hit = REASONS.find(([re]) => re.test(reason));
  return new CliError(hit ? hit[1] : `http_${r.status}`, reason, hit ? hit[2] : '', hit ? hit[3] : [], undefined);
}

export async function run({ flags }){
  let given = ['email', 'phone', 'linkedin'].filter(k => flags[k]);
  if(given.length !== 1){ throw usageError('enrich takes exactly one of --email, --phone or --linkedin.', [{ command : 'sqid enrich --email jane@acme.com', description : 'By email' }, { command : 'sqid enrich --linkedin https://www.linkedin.com/in/jane-doe', description : 'By LinkedIn profile' }]); }
  let site = await resolveSite(flags);
  let key  = await sdkKeyFor(site, flags);
  let body = { ...(flags.email ? { email : String(flags.email) } : flags.phone ? { phone : String(flags.phone) } : { linkedin_url : String(flags.linkedin) }), ...(flags.force ? { forceUpdate : true } : {}) };
  let r = await publicApi('POST', '/visitors/enrichment', { key, body });
  if(!r.ok){ throw enrichError(r, site); }
  // 200 false: nothing known for that identifier, and no credit was spent.
  if(r.data === false || r.data == null){ return { data : { match : false, credit_used : false }, text : 'No match for that identifier (no credit used).' }; }
  return { data : r.data, text : JSON.stringify(r.data, null, 2), next : [{ command : 'sqid visitors list --search <company>', when : 'to see if they have been on the site' }] };
}
