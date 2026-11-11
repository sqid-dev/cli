import os from 'node:os';
import { loginLoopback, loginDevice, userinfo } from '../../oauth.js';
import { writeCredentials, readCredentials } from '../../credentials.js';
import { isAgentHarness } from '../../output.js';

export const help = `sqid auth login [--device] [--no-browser] [--force]

Signs you in to Sqid (or signs you up) in your browser and keeps a token on this
machine. Nothing secret passes through the terminal.

  --device       Print a URL and a code instead; approve from any device (SSH, containers)
  --no-browser   Do not try to open a browser; just print the URL
  --force        Sign in again even if credentials are present
`;

export async function run({ flags, out }){
  let existing = await readCredentials();
  if(existing?.source === 'env'){
    return { data : { signed_in : true, source : 'env' }, text : 'SQID_TOKEN is set; nothing to do.', next : [{ command : 'sqid whoami', when : 'to see who that token is' }] };
  }
  if(existing && !flags.force){
    return { data : { signed_in : true, source : 'file' }, text : 'Already signed in. Use --force to sign in again.', next : [{ command : 'sqid whoami', when : 'to check the account' }] };
  }

  let tokens;
  if(flags.device){
    out.note('Sign in from any device:');
    tokens = await loginDevice({ onCode : ({ url, code }) => {
      out.note(`\n  Open   ${url}\n  Code   ${code}\n`);
      if(out.agent){ process.stderr.write(JSON.stringify({ event : 'device_code', url, code }) + '\n'); }
      out.note('Waiting for approval...');
    } });
  } else {
    tokens = await loginLoopback({ open : flags.browser !== false, onUrl : (url, { opened }) => {
      out.note(opened ? 'Opening your browser to sign in. If it does not open, use this link:' : 'Open this link in your browser to sign in:');
      out.note(`\n  ${url}\n`);
      if(out.agent){ process.stderr.write(JSON.stringify({ event : 'login_url', url, opened }) + '\n'); }
      out.note('Waiting for the browser...');
    } });
  }

  let info = await userinfo(tokens.access_token).catch(() => null);
  let file = await writeCredentials({
    ...tokens,
    email      : info?.email,
    user_id    : info?.sub || info?.user_id,
    issued_on  : os.hostname(),
    issued_at  : new Date().toISOString(),
    agent      : isAgentHarness() || undefined
  });

  return {
    data : { signed_in : true, email : info?.email || null, stored_in : file },
    text : `Signed in${info?.email ? ' as ' + info.email : ''}.`,
    next : [
      { command : 'sqid whoami', when : 'to see the account and its sites' },
      { command : 'sqid init',   when : 'to create a site for this project and get the snippet' }
    ]
  };
}
