// Billing: status, card (browser), topup, auto-reload, invoices. Plan and packs are
// their own commands. Card numbers never pass through the terminal: `card` opens the
// console's billing page and waits until a card lands.
import { api } from '../api.js';
import { CliError, usageError } from '../errors.js';
import { openBrowser } from '../oauth.js';
import { API_ORIGIN } from '../meta.js';

export const help = `Usage: sqid billing <command>

Commands:
  status                                   Plan, card, balance, allowance, auto-reload, this month's usage
  card [--no-browser]                      Add or change the card in your browser; waits until it is saved
  topup <usd>                              Charge the saved card and add credit (Developer plan; min $5)
  auto-reload on --threshold <usd> --amount <usd> | on --threshold-credits <n> --pack <n> | off
  invoices                                 Recent invoices
`;

const usd = (cents) => cents == null ? null : `$${(cents / 100).toFixed(2)}`;

export async function run({ args, flags, out, mode }){
  let sub = args[0] || 'status';
  let q = flags.account ? `?account=${encodeURIComponent(flags.account)}` : '';

  if(sub === 'status'){
    let [overview, account, usage] = await Promise.all([api('GET', `/api/sqid/billing${q}`, { flags }), api('GET', `/api/sqid/billing/account${q}`, { flags }).catch(() => null), api('GET', `/api/sqid/billing/usage${q}`, { flags }).catch(() => null)]);
    let card = (overview?.cards || []).find(c => c.default) || overview?.cards?.[0] || account?.card || null;
    let data = { plan : overview?.plan ?? account?.plan ?? null, card : card ? { brand : card.brand, last4 : card.last4 } : null, balance : account?.balance ?? null, paused : account?.paused ?? null, payment_issue : account?.payment_issue ?? null, auto_reload : account?.auto_reload ?? null, oem : account?.oem ?? null, usage : usage?.identifications?.totals ? { month : usage.month, ...usage.identifications.totals } : null, raw : { overview, account, usage } };
    return {
      data,
      text : [`Plan: ${typeof data.plan === 'object' ? JSON.stringify(data.plan) : data.plan}`, `Card: ${card ? `${card.brand} •••• ${card.last4}` : 'none on file'}`, data.balance != null ? `Balance: ${typeof data.balance === 'object' ? JSON.stringify(data.balance) : data.balance}` : null, data.usage ? `This month: ${data.usage.first} first identifications, ${data.usage.returning} returning, ${data.usage.plus} plus` : null, data.payment_issue ? `Payment issue: ${JSON.stringify(data.payment_issue)}` : null].filter(Boolean).join('\n'),
      next : card ? [] : [{ command : 'sqid billing card', when : 'to add a card in the browser' }]
    };
  }

  if(sub === 'card'){
    let url = `${(flags.api || API_ORIGIN)}/billing?from=cli`;
    let before = await api('GET', `/api/sqid/billing${q}`, { flags }).catch(() => null);
    let had = (before?.cards || []).map(c => c.id).sort().join(',');
    let opened = flags.browser !== false && openBrowser(url);
    out.note(opened ? `Opening ${url} to add a card. Waiting...` : `Open ${url} in your browser to add a card. Waiting...`);
    if(mode === 'agent'){ process.stderr.write(JSON.stringify({ event : 'open_url', url, opened : !!opened }) + '\n'); }
    let until = Date.now() + 10 * 60 * 1000;
    while(Date.now() < until){
      await new Promise(r => setTimeout(r, 4000));
      let now = await api('GET', `/api/sqid/billing${q}`, { flags }).catch(() => null);
      let ids = (now?.cards || []).map(c => c.id).sort().join(',');
      if(ids && ids !== had){ let c = now.cards.find(x => x.default) || now.cards[0]; return { data : { card : { brand : c.brand, last4 : c.last4 } }, text : `Card saved: ${c.brand} •••• ${c.last4}.`, next : [{ command : 'sqid billing status', when : 'to see the account' }] }; }
    }
    throw new CliError('card_timeout', 'No new card appeared within 10 minutes.', 'Finish adding the card in the browser, then run `sqid billing status`.', [{ command : 'sqid billing status', description : 'Check again' }]);
  }

  if(sub === 'topup'){
    let amount = Number(args[1]);
    if(!(amount >= 5)){ throw usageError('topup needs an amount in dollars, at least 5.', [{ command : 'sqid billing topup 20', description : 'Add $20 of credit' }]); }
    let r = await api('POST', `/api/sqid/billing/topup${q}`, { flags, body : { amount_cents : Math.round(amount * 100) } });
    return { data : r, text : `Top-up of ${usd(Math.round(amount * 100))} submitted.`, next : [{ command : 'sqid billing status', when : 'to see the balance once the payment settles' }] };
  }

  if(sub === 'auto-reload'){
    let state = args[1];
    if(state === 'off'){ let r = await api('PUT', `/api/sqid/billing/auto-reload${q}`, { flags, body : { enabled : false } }); return { data : r, text : 'Auto-reload off.' }; }
    if(state !== 'on'){ throw usageError('auto-reload on|off', [{ command : 'sqid billing auto-reload on --threshold 10 --amount 50', description : 'Developer: when balance falls to $10, add $50' }, { command : 'sqid billing auto-reload on --threshold-credits 100 --pack 1000', description : 'OEM: when credits fall to 100, buy the 1000 pack' }]); }
    let body = flags['threshold-credits'] ? { enabled : true, threshold_credits : Number(flags['threshold-credits']), pack : Number(flags.pack) } : { enabled : true, threshold_cents : Math.round(Number(flags.threshold) * 100), amount_cents : Math.round(Number(flags.amount) * 100) };
    let r = await api('PUT', `/api/sqid/billing/auto-reload${q}`, { flags, body });
    return { data : r, text : 'Auto-reload on.' };
  }

  if(sub === 'invoices'){
    let r = await api('GET', `/api/sqid/billing/invoices${q}`, { flags });
    let rows = r?.invoices || r?.data || (Array.isArray(r) ? r : []);
    return { data : rows, text : rows.length ? rows.map(i => `${i.number || i.id}  ${i.status || ''}  ${usd(i.total ?? i.amount_due) || ''}  ${i.created ? new Date(i.created * 1000 || i.created).toISOString().slice(0, 10) : ''}  ${i.hosted_invoice_url || ''}`).join('\n') : 'No invoices yet.' };
  }
  throw usageError(`billing: unknown subcommand "${sub}".`, [{ command : 'sqid billing status', description : 'Account overview' }]);
}
