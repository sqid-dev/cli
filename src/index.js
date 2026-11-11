// Entry point: parse argv, pick the mode (human on a TTY, agent otherwise), run
// the command, print its result as text or JSON. Every command returns
// { data, next } or throws a CliError { code, message, remedy, examples }.

import { CliError, usageError } from './errors.js';
import { parseArgs } from './args.js';
import { pickMode, Output } from './output.js';
import { version } from './meta.js';

const COMMANDS = {
  login  : () => import('./commands/login.js'),
  logout : () => import('./commands/logout.js'),
  whoami : () => import('./commands/whoami.js')
};

const HELP = `sqid ${version}  Sqid from the terminal and from coding agents.

Usage: sqid <command> [options]

Account
  login              Sign in or sign up in your browser (--device for SSH/headless, --no-browser to print the URL only)
  logout             Revoke this machine's token and forget it
  whoami             Who is signed in, which account, which credentials are present

Global options
  --json             Machine-readable output (default when stdout is not a terminal)
  --mode agent|human Force a mode (also SQID_MODE)
  --api <url>        API origin (default https://app.sqid.dev, also SQID_API)
  --yes              Confirm destructive commands without a prompt
  --help, -h         This help
  --version, -v      Version

Docs: https://docs.sqid.dev   Full text for agents: https://docs.sqid.dev/llms-full.txt
`;

export async function main(argv){
  let { command, args, flags } = parseArgs(argv);
  let mode = pickMode(flags);
  let out  = new Output(mode);

  if(flags.version || flags.v){ out.text(version); out.json({ version }); return 0; }
  if(!command || flags.help || flags.h){
    if(command && COMMANDS[command]){ return runHelp(command, out); }
    out.text(HELP); out.json({ commands : Object.keys(COMMANDS), help : HELP });
    return 0;
  }

  let loader = COMMANDS[command];
  if(!loader){
    return out.fail(usageError(`Unknown command "${command}".`, [{ command : 'sqid --help', description : 'List commands' }]));
  }

  try{
    let mod    = await loader();
    let result = await mod.run({ args, flags, mode, out });
    out.result(result);
    return 0;
  }catch(error){
    if(error instanceof CliError){ return out.fail(error); }
    return out.fail(new CliError('unexpected_error', error?.message || String(error), 'Run again with --debug for the stack.', [], error));
  }
}

async function runHelp(command, out){
  let mod = await COMMANDS[command]();
  out.text(mod.help || HELP);
  out.json({ command, help : mod.help || HELP });
  return 0;
}
