import { readCredentials } from '../../credentials.js';

export const help = `sqid auth status

Whether this machine holds Sqid credentials, where they came from, when the access token expires.
Does not call the API (use whoami for that).
`;

export async function run(){
  let c = await readCredentials();
  if(!c){ return { data : { signed_in : false }, text : 'Not signed in.', next : [{ command : 'sqid auth login', when : 'to sign in with your browser' }] }; }
  let data = { signed_in : true, source : c.source, email : c.email || null, expires_at : c.expires_at ? new Date(c.expires_at).toISOString() : null, refreshable : !!c.refresh_token, issued_on : c.issued_on || null };
  return { data, text : `Signed in${data.email ? ' as ' + data.email : ''} (${c.source === 'env' ? 'SQID_TOKEN' : 'browser login'}${data.expires_at ? ', token until ' + data.expires_at : ''}).`, next : [{ command : 'sqid whoami', when : 'to check the account with the API' }] };
}
