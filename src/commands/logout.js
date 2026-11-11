import { readCredentials, deleteCredentials } from '../credentials.js';
import { revoke } from '../oauth.js';

export const help = `sqid logout [--yes]

Revokes this machine's token at Sqid and deletes the local credentials file.
Account keys made by the CLI stay until you delete them (sqid keys, or the console).
`;

export async function run({ flags, mode }){
  let creds = await readCredentials();
  if(!creds){ return { data : { signed_out : true, had_credentials : false }, text : 'Not signed in.' }; }
  if(creds.source === 'env'){ return { data : { signed_out : false, source : 'env' }, text : 'SQID_TOKEN is set in the environment; unset it to sign out.' }; }
  if(mode === 'agent' && !flags.yes){
    const { CliError } = await import('../errors.js');
    throw new CliError('confirm_required', 'logout revokes this machine’s token.', 'Pass --yes to confirm.', [{ command : 'sqid logout --yes', description : 'Revoke and forget the token' }], undefined, 2);
  }
  let revoked = false;
  try{ revoked = await revoke(creds.refresh_token || creds.access_token, creds.refresh_token ? 'refresh_token' : 'access_token'); }catch(error){ /* network: still forget locally */ }
  await deleteCredentials();
  return { data : { signed_out : true, revoked }, text : revoked ? 'Signed out; token revoked.' : 'Signed out locally (Sqid could not be reached to revoke the token).', next : [{ command : 'sqid login', when : 'to sign in again' }] };
}
