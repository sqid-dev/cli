// A real-looking website (Driftwood) with the Sqid panel docked on the side, on localhost. For
// people who want to see Sqid work before, or instead of, putting it on their own site. Lives in
// its own package (@sqid-dev/playground); this command runs it with the same sign-in.

import { spawn } from 'node:child_process';
import { CliError } from '../errors.js';

export const help = `Usage: sqid playground [--port <n>] [--no-open]

Runs the Sqid Playground: a demo website (Driftwood, a desk company) with a Sqid panel
docked on the side. Watch a visitor get identified, try the scenarios and recipes, see
the record that goes out, then go live on your own site from the panel.

Uses your sign-in and your account's Sandbox site, which never spends a credit.
Same as: npx -y @sqid-dev/playground
`;

export async function run({ flags, mode, out }){
  let args = [];
  if(flags.port){ args.push('--port', String(flags.port)); }
  if(flags.open === false || flags['no-open']){ args.push('--no-open'); }
  if(flags.api){ args.push('--api', String(flags.api)); }
  if(flags.site){ args.push('--site', String(flags.site)); }

  let npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  out.note('Starting the Sqid Playground (first run downloads @sqid-dev/playground)...');
  let child = spawn(npx, ['-y', '@sqid-dev/playground', ...args], { stdio : 'inherit', env : process.env });
  let code = await new Promise(resolve => { child.on('exit', resolve); child.on('error', () => resolve(1)); });
  if(code && code !== 0){ throw new CliError('playground_failed', `The playground exited with code ${code}.`, 'Run it directly to see why.', [{ command : 'npx -y @sqid-dev/playground', description : 'Run the playground on its own' }], undefined, code); }
  return { data : { ok : true }, text : '' };
}
