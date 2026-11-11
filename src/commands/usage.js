// Identifications this month (or --month YYYY-MM), per site and in total.
import { api } from '../api.js';

export const help = `Usage: sqid usage [--month YYYY-MM]

Identifications billed this month: first, returning, plus, and units, per site.
`;

export async function run({ flags }){
  let q = new URLSearchParams(); if(flags.month){ q.set('month', String(flags.month)); } if(flags.account){ q.set('account', String(flags.account)); }
  let r = await api('GET', `/api/sqid/billing/usage?${q}`, { flags });
  let t = r?.identifications?.totals || {}, sites = r?.identifications?.sites || [];
  return { data : r, text : [`${r?.month}: ${t.first ?? 0} first, ${t.returning ?? 0} returning, ${t.plus ?? 0} plus (${t.units ?? 0} units, ${r?.mode || ''})`, ...sites.map(s => `  ${s.sdk_id}  ${s.first} / ${s.returning} / ${s.plus}`)].join('\n') };
}
