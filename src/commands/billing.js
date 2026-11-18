// Billing: status, card (browser), topup, auto-reload, invoices. Plan and packs are
// their own commands. Card numbers never pass through the terminal: `card` opens the
// console's billing page and waits until a card lands.
import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { openBrowser } from '../oauth.js';
import { API_ORIGIN } from '../meta.js';
import { requestId } from './plan.js';

export const help = `Usage: sqid billing <command>

Commands:
  status                                   Plan, card, balance, allowance, auto-reload, this month's usage
  card [--no-browser]                      Add or change the card in your browser; waits until it is saved
  topup <usd>                              Developer: add credits on the saved card ($5 to $10,000; $0.25 a credit)
  auto-reload on --threshold <usd> --target <usd>   Developer: at $threshold, refill the balance to $target
  auto-reload on --threshold-credits <n> --pack <n> OEM Launch: at n credits (10 or more), buy the pack
  auto-reload off
  invoices                                 Recent invoices (PDF and receipt links)

OEM Launch buys credits in packs: sqid plan packs buy <1000|5000|10000|25000>.
`;

const usd = (cents) => cents == null ? null : `$${(cents / 100).toFixed(2)}`;
// The overview's plan is the Stripe subscription view ({ status, items:[{name, amount}], trial, current_period_end }).
const planLine = (p) => !p ? 'none' : typeof p !== 'object' ? String(p) : `${p.items?.[0]?.name || p.name || 'plan'}${p.trial ? ' (trial)' : ''}${p.status ? `, ${p.status}` : ''}${p.current_period_end ? `, renews ${String(p.current_period_end).slice(0, 10)}` : ''}${p.cancel_at_period_end ? ', cancels at period end' : ''}`;

// OEM Launch: the plan kind billing reports (credits.plan.kind), else the ledger plan.
const isOem = (a) => (a?.credits?.plan?.kind && a.credits.plan.kind !== 'other' ? a.credits.plan.kind : a?.credits?.plan_state?.plan || a?.plan) === 'oem';
// Developer refills to a target (credits at 25 cents); OEM Launch buys a pack (target is null there).
const autoReloadLine = (ar, oem) => ar.pack || oem ? `Auto-reload: at ${ar.below} credits, buy the ${ar.pack} pack` : `Auto-reload: at ${usd(ar.below * 25)}, refill to ${usd(ar.target * 25)}`;

export async function run({ args, flags, out, mode }){
  let sub = args[0] || 'status';
  let q = flags.account ? `?account=${encodeURIComponent(flags.account)}` : '';

  if(sub === 'status'){
    let [overview, account, usage] = await Promise.all([api('GET', `/api/sqid/billing${q}`, { flags }), api('GET', `/api/sqid/billing/account${q}`, { flags }).catch(() => null), api('GET', `/api/sqid/billing/usage${q}`, { flags }).catch(() => null)]);
    let card = (overview?.cards || []).find(c => c.default) || overview?.cards?.[0] || account?.card || null;
    let cr = account?.credits || null;   // Developer and OEM Launch: credits in the billing micro
    let oem = isOem(account);
    // Only Developer credits have a dollar value (25 cents each); OEM Launch credits come with the plan or in packs.
    let credits = cr ? { available : cr.available, unlimited : cr.unlimited, dollars : oem || cr.available == null ? null : usd(cr.available * cr.cents_per_credit), next_expiry : cr.next_expiry, auto_reload : cr.auto_reload } : null;
    let data = { plan : overview?.plan ?? account?.plan ?? null, card : card ? { brand : card.brand, last4 : card.last4 } : null, credits, balance : cr ? null : account?.balance ?? null, paused : account?.paused ?? null, payment_issue : account?.payment_issue ?? null, auto_reload : cr ? cr.auto_reload : account?.auto_reload ?? null, oem : account?.oem ?? null, usage : usage?.identifications?.totals ? { month : usage.month, ...usage.identifications.totals } : null, raw : { overview, account, usage } };
    return {
      data,
      text : [`Plan: ${planLine(data.plan)}`, `Card: ${card ? `${card.brand} •••• ${card.last4}` : 'none on file'}`, credits ? (credits.unlimited ? 'Credits: unlimited' : `Credits: ${credits.available}${credits.dollars ? ` (${credits.dollars})` : ''}${credits.next_expiry ? `, ${credits.next_expiry.credits} expire ${String(credits.next_expiry.at).slice(0, 10)}` : ''}`) : null, credits?.auto_reload?.enabled ? autoReloadLine(credits.auto_reload, oem) : null, data.balance != null ? `Balance: ${typeof data.balance === 'object' ? JSON.stringify(data.balance) : data.balance}` : null, data.usage ? `This month: ${data.usage.first} first identifications, ${data.usage.returning} returning, ${data.usage.plus} plus` : null, data.payment_issue ? `Payment issue: ${JSON.stringify(data.payment_issue)}` : null].filter(Boolean).join('\n'),
      next : card ? [] : [{ command : 'sqid billing card', when : 'to add a card in the browser' }]
    };
  }

  if(sub === 'card'){
    // A one-time Stripe page that saves a card for this account (no console sign-in); the console's card form
    // if a link can't be made (a trial, too many links in an hour, an older console).
    let link = await api('POST', `/api/sqid/billing/card-link${q}`, { flags, body : {} }).catch(() => null);
    let url = /^https:\/\/checkout\.stripe\.com\//.test(String(link?.url || '')) ? link.url : `${(flags.api || API_ORIGIN)}/billing?from=cli&add=card`;
    let before = await api('GET', `/api/sqid/billing${q}`, { flags }).catch(() => null);
    let had = (before?.cards || []).map(c => c.id).sort().join(',');
    let opened = flags.browser !== false && openBrowser(url);
    out.note(opened ? `Opening a secure Stripe page to add a card (nothing is charged). Waiting...\n  ${url}` : `Open this secure Stripe page to add a card (nothing is charged; it works once, for 30 minutes). Waiting...\n  ${url}`);
    if(mode === 'agent'){ process.stderr.write(JSON.stringify({ event : 'open_url', url, opened : !!opened }) + '\n'); }
    let until = Date.now() + 10 * 60 * 1000;
    let tick = 0;
    while(Date.now() < until){
      await new Promise(r => setTimeout(r, 4000));
      // every 4th check reads fresh from Stripe (the console caches its view for a few minutes)
      let now = (++tick % 4 === 0 ? await api('POST', `/api/sqid/billing/refresh${q}`, { flags, body : {} }).catch(() => null) : null)
             || await api('GET', `/api/sqid/billing${q}`, { flags }).catch(() => null);
      let ids = (now?.cards || []).map(c => c.id).sort().join(',');
      if(ids && ids !== had){ let c = now.cards.find(x => x.default) || now.cards[0]; return { data : { card : { brand : c.brand, last4 : c.last4 } }, text : `Card saved: ${c.brand} •••• ${c.last4}.`, next : [{ command : 'sqid billing status', when : 'to see the account' }] }; }
    }
    throw new CliError('card_timeout', 'No new card appeared within 10 minutes.', 'Finish adding the card in the browser, then run `sqid billing status`.', [{ command : 'sqid billing status', description : 'Check again' }]);
  }

  if(sub === 'topup'){
    let amount = Number(args[1]);
    if(!Number.isInteger(amount) || amount < 5 || amount > 10000){ throw usageError('topup needs a whole number of dollars, 5 to 10000.', [{ command : 'sqid billing topup 25', description : 'Add $25 (100 credits)' }]); }
    let account = await api('GET', `/api/sqid/billing/account${q}`, { flags }).catch(() => null);
    if(isOem(account)){ throw new CliError('packs_only', 'OEM Launch buys credits in packs, not dollar amounts.', 'Buy a pack instead.', [{ command : 'sqid plan packs buy 1000', description : '1,000 credits for $200' }, { command : 'sqid plan packs buy 5000', description : '5,000 credits for $900' }]); }
    let credits = amount * 4;   // $0.25 a credit
    let request_id = requestId();
    let r = await api('POST', `/api/sqid/billing/topup${q}`, { flags, body : { credits, request_id } });
    if(r?.status === 'requires_action'){
      let url = `${(flags.api || API_ORIGIN)}/billing`;
      return { data : r, text : `Your bank wants to confirm this ${usd(amount * 100)} payment. Finish it in the console: ${url}`, next : [{ command : 'sqid billing status', when : 'after confirming in the console' }] };
    }
    if(!r?.credited){ throw new CliError('charge_failed', r?.reason || 'The card was declined.', 'Update the card with `sqid billing card`, then try again.', [{ command : 'sqid billing card', description : 'Change the card' }]); }
    return { data : r, text : `Added ${credits} credits (${usd(amount * 100)}). A receipt is in \`sqid billing invoices\`.`, next : [{ command : 'sqid billing status', when : 'to see the balance' }] };
  }

  if(sub === 'auto-reload'){
    let state = args[1];
    if(state === 'off'){ let r = await api('PUT', `/api/sqid/billing/auto-reload${q}`, { flags, body : { enabled : false } }); return { data : r, text : 'Auto-reload off.' }; }
    if(state !== 'on'){ throw usageError('auto-reload on|off', [{ command : 'sqid billing auto-reload on --threshold 5 --target 25', description : 'Developer: when the balance falls to $5, refill it to $25' }, { command : 'sqid billing auto-reload on --threshold-credits 100 --pack 1000', description : 'OEM: when credits fall to 100, buy the 1000 pack' }]); }
    let body;
    if(flags['threshold-credits'] != null){
      let below = Number(flags['threshold-credits']), pack = Number(flags.pack);
      if(!Number.isInteger(below) || below < 10 || ![1000, 5000, 10000, 25000].includes(pack)){ throw usageError('OEM auto-reload needs --threshold-credits <n> (10 or more) and --pack 1000|5000|10000|25000.', [{ command : 'sqid billing auto-reload on --threshold-credits 100 --pack 1000', description : 'At 100 credits, buy 1,000' }]); }
      body = { enabled : true, below, pack };   // credits.js reads below + pack
    }
    else {
      let at = Number(flags.threshold), to = Number(flags.target);
      if(!Number.isInteger(at) || at < 5 || !Number.isInteger(to) || to < at + 10){ throw usageError('Developer auto-reload needs --threshold <usd> (5 or more) and --target <usd> (at least 10 more).', [{ command : 'sqid billing auto-reload on --threshold 5 --target 25', description : 'At $5, refill to $25' }]); }
      body = { enabled : true, below : at * 4, target : to * 4 };   // credits at $0.25
    }
    let r = await api('PUT', `/api/sqid/billing/auto-reload${q}`, { flags, body });
    return { data : r, text : body.pack ? `Auto-reload on: at ${body.below} credits, buy the ${body.pack} pack.` : `Auto-reload on: at ${usd(body.below * 25)}, refill to ${usd(body.target * 25)}.` };
  }

  if(sub === 'invoices'){
    let r = await api('GET', `/api/sqid/billing/invoices${q}`, { flags });
    let rows = r?.invoices || r?.data || (Array.isArray(r) ? r : []);
    return { data : rows, text : rows.length ? rows.map(i => `${i.number || i.id}  ${i.status || ''}  ${usd(i.total ?? i.amount_due) || ''}  ${i.created ? new Date(typeof i.created === 'number' ? i.created * 1000 : i.created).toISOString().slice(0, 10) : ''}  ${i.pdf || i.receipt || ''}`).join('\n') : 'No invoices yet.' };
  }
  throw usageError(`billing: unknown subcommand "${sub}".`, [{ command : 'sqid billing status', description : 'Account overview' }]);
}
