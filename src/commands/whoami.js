import { readCredentials } from '../credentials.js';
import { api } from '../api.js';
import { userinfo } from '../oauth.js';
import { notSignedIn } from '../errors.js';

export const help = `sqid whoami

Who is signed in on this machine: email, account, role, sites, which credentials are present.
`;

export async function run({ flags }){
  let creds = await readCredentials();
  if(!creds){ throw notSignedIn(); }

  let me = null, error = null;
  try{ me = await api('GET', '/api/sqid/me', { flags }); }
  catch(e){ error = e; }

  let info = me ? null : await userinfo(creds.access_token).catch(() => null);
  let data = {
    credentials : { source : creds.source, expires_at : creds.expires_at ? new Date(creds.expires_at).toISOString() : undefined, issued_on : creds.issued_on },
    email       : me?.email || me?.user?.email || info?.email || creds.email || null,
    account     : me ? { role : me.role, hasSubscription : me.account?.hasSubscription, plan : me.account?.plan?.name || me.account?.plan || undefined } : undefined,
    api         : me ? 'ok' : { error : error?.code, message : error?.message }
  };
  if(!me && error?.exit === 3){ throw error; }
  return {
    data,
    text : (d) => [
      `Signed in as ${d.email || 'unknown'} (${d.credentials.source === 'env' ? 'SQID_TOKEN' : 'browser login'})`,
      d.account ? `Role ${d.account.role}${d.account.plan ? ', plan ' + d.account.plan : ''}${d.account.hasSubscription === false ? ', no subscription yet' : ''}` : `Sqid API: ${d.api.message}`
    ].join('\n'),
    next : me ? [{ command : 'sqid init', when : 'to create a site for this project' }] : []
  };
}
