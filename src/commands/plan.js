// Plan changes and OEM credit packs.
import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { API_ORIGIN } from '../meta.js';

export const help = `Usage: sqid plan <command>

Commands:
  show                                    Current plan, renewal, pending downgrade
  set oem --accept-terms                  Upgrade to OEM Launch now ($675/month, 500 identifications a month included). Needs a card.
  set developer --yes                     Back to Developer at the end of the period
  packs buy <1000|5000|10000|25000>       OEM Launch: buy a credit pack on the saved card
                                          (1,000 $200 · 5,000 $900 · 10,000 $1,700 · 25,000 $4,000)

OEM Launch addendum: https://sqid.dev/oem-launch-terms.html
Pricing: https://docs.sqid.dev/console/billing
`;

export const OEM_TERMS_URL = 'https://sqid.dev/oem-launch-terms.html';
export const PACKS = { 1000 : 200, 5000 : 900, 10000 : 1700, 25000 : 4000 };   // credits -> USD

const ERR = {
  no_card         : ['Add a card first.', 'sqid billing card'],
  terms_required  : [`Pass --accept-terms to accept the OEM Launch addendum (${OEM_TERMS_URL}).`, 'sqid plan set oem --accept-terms'],
  already_oem     : ['The account is already on OEM.', 'sqid plan show'],
  upgrade_pending : ['An upgrade is already in flight; give it a minute.', 'sqid plan show'],
  not_live        : ['Billing is not live on this account yet.', 'sqid billing status'],
  not_oem         : ['Packs are for the OEM Launch plan.', 'sqid plan set oem --accept-terms'],
  not_developer   : ['Only a Sqid Developer account upgrades to OEM Launch here; ask Sqid about this plan.', 'sqid plan show'],
  owner_only      : ['Only the account owner can do this.', 'sqid whoami'],
  invalid_pack    : ['Packs are 1000, 5000, 10000 or 25000 credits.', 'sqid plan packs buy 1000']
};
const wrap = (error) => { let m = ERR[error.code]; return m ? new CliError(error.code, error.message, m[0], [{ command : m[1], description : m[0] }], error) : error; };
// The billing routes take an id per click (8 to 64 of A-Z a-z 0-9 _ -) so a retry never charges twice.
export const requestId = () => `cli-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const day = (d) => d ? String(typeof d === 'number' ? new Date(d < 1e12 ? d * 1000 : d).toISOString() : d).slice(0, 10) : null;
const dollars = (n) => `$${n.toLocaleString('en-US')}`;

// A payment answer from the billing routes: paid, failed (declined), requires_action (3-D Secure, finished in the console).
export function paymentOutcome(r, { what, flags, ok }){
  if(r?.status === 'requires_action'){
    let url = `${(flags.api || API_ORIGIN)}/billing`;
    return { data : r, text : `Your bank wants to confirm the ${what}. Finish it in the console: ${url}`, next : [{ command : 'sqid billing status', when : 'after confirming in the console' }] };
  }
  if(r?.status === 'failed' || (r?.credited === false && r?.reason)){ throw new CliError('charge_failed', r.reason || 'The card was declined.', 'Update the card with `sqid billing card`, then try again.', [{ command : 'sqid billing card', description : 'Change the card' }]); }
  return ok;
}

// /api/sqid/billing/account → readable lines. Credits accounts carry the plan in credits.plan ({ name, kind,
// included_per_month }) and its state in credits.plan_state ({ plan, period_end, downgrade_at, packs:{ credits, becomes } }).
export function planLines(r){
  let cr = r?.credits || null;
  let st = cr?.plan_state || null;
  let kind = cr?.plan?.kind && cr.plan.kind !== 'other' ? cr.plan.kind : st?.plan || r?.plan || cr?.plan?.kind || null;
  let name = cr?.plan?.name || (kind === 'oem' ? 'Sqid OEM Launch' : kind === 'developer' ? 'Sqid Developer' : kind);
  let lines = [`Plan: ${name || 'none'}`];
  if(cr?.plan?.included_per_month > 0){ lines.push(`Included: ${cr.plan.included_per_month} identifications a month`); }
  if(st?.period_end){ lines.push(`${st.downgrade_at ? 'Period ends' : 'Renews'}: ${day(st.period_end)}`); }
  if(st?.downgrade_at){ lines.push(`Downgrade to Developer scheduled: ${day(st.downgrade_at)}`); }
  if(st?.packs?.credits){ lines.push(`Pack credits: ${st.packs.credits}${st.packs.becomes != null ? ` (become ${st.packs.becomes} Developer credits on a downgrade)` : ''}`); }
  return { kind, name, lines };
}

export async function run({ args, flags, mode }){
  let [sub, a, b] = args;
  if(!sub || sub === 'show'){
    let r = await api('GET', '/api/sqid/billing/account', { flags });
    let { kind, name, lines } = planLines(r);
    return {
      data : { plan : kind, name, included_per_month : r?.credits?.plan?.included_per_month ?? null, plan_state : r?.credits?.plan_state || null },
      text : lines.join('\n'),
      next : kind === 'developer' ? [{ command : 'sqid plan set oem --accept-terms', when : 'to embed Sqid in a product you sell (OEM Launch, $675/month)' }] : kind === 'oem' ? [{ command : 'sqid plan packs buy 1000', when : 'to add credits beyond the 500 included' }] : []
    };
  }
  if(sub === 'set'){
    if(a === 'oem'){
      if(flags['accept-terms'] !== true){ throw new CliError('terms_required', 'Upgrading to OEM Launch accepts the OEM Launch addendum.', ERR.terms_required[0], [{ command : ERR.terms_required[1], description : 'Upgrade' }], undefined, 2); }
      let r;
      try{ r = await api('POST', '/api/sqid/billing/plan', { flags, body : { plan : 'oem', accept_terms : true, request_id : requestId() } }); }catch(error){ throw wrap(error); }
      let text = r?.status === 'kept' ? 'Staying on OEM Launch; the scheduled downgrade is cancelled.' : 'Upgraded to OEM Launch ($675/month, 500 identifications a month included).';
      return paymentOutcome(r, { what : 'OEM Launch payment', flags, ok : { data : r, text, next : [{ command : 'sqid billing status', when : 'to see credits and the invoice' }] } });
    }
    if(a === 'developer'){
      if(mode === 'agent' && !flags.yes){ throw new CliError('confirm_required', 'Downgrading to Developer takes effect at the end of the period and ends OEM credits.', 'Pass --yes to confirm.', [{ command : 'sqid plan set developer --yes', description : 'Downgrade' }], undefined, 2); }
      try{ let r = await api('POST', '/api/sqid/billing/plan', { flags, body : { plan : 'developer' } }); return { data : r, text : r?.status === 'ended' ? 'Moved to Developer.' : `Downgrade to Developer scheduled${r?.cancel_at ? ` for ${day(r.cancel_at)}` : ' for the end of the period'}.` }; }catch(error){ throw wrap(error); }
    }
    throw usageError('plan set oem|developer', [{ command : 'sqid plan set oem --accept-terms', description : 'Upgrade' }]);
  }
  if(sub === 'packs' && a === 'buy'){
    let pack = Number(b);
    if(!PACKS[pack]){ throw usageError(ERR.invalid_pack[0], [{ command : 'sqid plan packs buy 5000', description : '5000 credits' }]); }
    let r;
    try{ r = await api('POST', '/api/sqid/billing/packs', { flags, body : { pack, request_id : requestId() } }); }catch(error){ throw wrap(error); }
    return paymentOutcome(r, { what : `${dollars(PACKS[pack])} pack payment`, flags, ok : {
      data : r,
      text : r?.credited ? `Added ${pack} credits (${dollars(PACKS[pack])}). A receipt is in \`sqid billing invoices\`.` : `Pack of ${pack} credits (${dollars(PACKS[pack])}) paid; the credits land when the payment settles.`,
      next : [{ command : 'sqid billing status', when : 'to see the credits' }]
    } });
  }
  throw usageError(`plan: unknown subcommand "${sub}".`, [{ command : 'sqid plan show', description : 'Current plan' }]);
}
