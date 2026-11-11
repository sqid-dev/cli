// Plan changes and OEM credit packs.
import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';

export const help = `Usage: sqid plan <command>

Commands:
  show                                    Current plan
  set oem --accept-terms                  Upgrade to OEM now ($500/month, 1000 credits included). Needs a card.
  set developer --yes                     Back to Developer at the end of the period
  packs buy <1000|5000|10000|25000>       OEM: buy a credit pack on the saved card
`;

const ERR = {
  no_card         : ['Add a card first.', 'sqid billing card'],
  terms_required  : ['Pass --accept-terms to accept the OEM addendum (https://docs.sqid.dev/billing).', 'sqid plan set oem --accept-terms'],
  already_oem     : ['The account is already on OEM.', 'sqid plan show'],
  upgrade_pending : ['An upgrade is already in flight; give it a minute.', 'sqid plan show'],
  not_live        : ['Billing is not live on this account yet.', 'sqid billing status'],
  not_oem         : ['Packs are for the OEM plan.', 'sqid plan set oem --accept-terms'],
  invalid_pack    : ['Packs are 1000, 5000, 10000 or 25000 credits.', 'sqid plan packs buy 1000']
};
const wrap = (error) => { let m = ERR[error.code]; return m ? new CliError(error.code, error.message, m[0], [{ command : m[1], description : m[0] }], error) : error; };

export async function run({ args, flags, mode }){
  let [sub, a, b] = args;
  if(!sub || sub === 'show'){ let r = await api('GET', '/api/sqid/billing/account', { flags }); let plan = r?.plan ?? r?.oem?.plan ?? null; return { data : { plan, oem : r?.oem || null, upgrade : r?.upgrade || null, packs : r?.packs || null }, text : `Plan: ${typeof plan === 'object' ? (plan.items?.[0]?.name || plan.name || JSON.stringify(plan)) : plan}${r?.upgrade ? `\nUpgrade: ${JSON.stringify(r.upgrade)}` : ''}` }; }
  if(sub === 'set'){
    if(a === 'oem'){
      if(flags['accept-terms'] !== true){ throw new CliError('terms_required', 'Upgrading to OEM accepts the OEM addendum.', ERR.terms_required[0], [{ command : ERR.terms_required[1], description : 'Upgrade' }], undefined, 2); }
      try{ let r = await api('POST', '/api/sqid/billing/plan', { flags, body : { plan : 'oem', accept_terms : true } }); return { data : r, text : 'Upgraded to OEM.', next : [{ command : 'sqid billing status', when : 'to see credits and the invoice' }] }; }catch(error){ throw wrap(error); }
    }
    if(a === 'developer'){
      if(mode === 'agent' && !flags.yes){ throw new CliError('confirm_required', 'Downgrading to Developer takes effect at the end of the period and ends OEM credits.', 'Pass --yes to confirm.', [{ command : 'sqid plan set developer --yes', description : 'Downgrade' }], undefined, 2); }
      try{ let r = await api('POST', '/api/sqid/billing/plan', { flags, body : { plan : 'developer' } }); return { data : r, text : 'Downgrade to Developer scheduled for the end of the period.' }; }catch(error){ throw wrap(error); }
    }
    throw usageError('plan set oem|developer', [{ command : 'sqid plan set oem --accept-terms', description : 'Upgrade' }]);
  }
  if(sub === 'packs' && a === 'buy'){
    let pack = Number(b);
    if(![1000, 5000, 10000, 25000].includes(pack)){ throw usageError(ERR.invalid_pack[0], [{ command : 'sqid plan packs buy 5000', description : '5000 credits' }]); }
    try{ let r = await api('POST', '/api/sqid/billing/packs', { flags, body : { pack } }); return { data : r, text : `Pack of ${pack} credits purchased.`, next : [{ command : 'sqid billing status', when : 'credits land when the payment settles' }] }; }catch(error){ throw wrap(error); }
  }
  throw usageError(`plan: unknown subcommand "${sub}".`, [{ command : 'sqid plan show', description : 'Current plan' }]);
}
