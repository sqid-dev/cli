// Entry point: parse argv, pick the mode (human on a TTY, agent otherwise), run
// the command, print its result as text or JSON. Every command module exports
// `help` and `run({ args, flags, mode, out })`, returns { data, next, text } or
// throws a CliError { code, message, remedy, examples }.

import { CliError, usageError } from './errors.js';
import { parseArgs, expandInputJson } from './args.js';
import { pickMode, Output } from './output.js';
import { version } from './meta.js';

const COMMANDS = {
  auth    : () => import('./commands/auth/index.js'),
  init    : () => import('./commands/init.js'),
  doctor  : () => import('./commands/doctor.js'),
  enrich  : () => import('./commands/enrich.js'),
  keys    : () => import('./commands/keys.js'),
  snippet : () => import('./commands/snippet.js'),
  sites   : () => import('./commands/sites.js'),
  skill   : () => import('./commands/skill.js'),
  visitors: () => import('./commands/visitors.js'),
  webhook : () => import('./commands/webhook.js'),
  whoami  : () => import('./commands/whoami.js')
};

// Short forms people type by habit. `sqid login` is `sqid auth login`.
const ALIASES = {
  login   : ['auth', 'login'],
  signin  : ['auth', 'login'],
  signup  : ['auth', 'login'],
  logout  : ['auth', 'logout'],
  signout : ['auth', 'logout']
};

export const USAGE = `Usage: sqid [options] [command]

Sqid CLI

Options:
  -h, --help           Display help for command
  --input-json <json>  Pass command options as a JSON string, @file.json, or -
                       for stdin
  --json               Emit JSON on stdout (default when stdout is not a TTY)
  --mode <mode>        Force interaction mode (human or agent). Also settable
                       via the SQID_MODE environment variable. Defaults to
                       agent when run without a TTY.
  --site <id|name>     Which site a command acts on (default: .sqid.json, or
                       the only site)
  -v, --version        Output the version number
  --verbose            Show detailed output (enables debug messages)
  --yes                Confirm destructive commands without a prompt

Commands:
  auth                                            Manage authentication (login, logout, status)
  doctor           [options]                      Check this project's Sqid integration health
  enrich           [options]                      Look a person up by email, phone or LinkedIn URL
  help             [command]                      Display help for command
  init             [options]                      Create a site for this project and print the snippet
  keys                                            SDK keys for the site (the REST visitor API)
  sites                                           List the sites on this account
  skill                                           Install the Claude Code skill for this CLI globally
  snippet          [options]                      Print the install snippet for the site
  visitors                                        Identified visitors: list, get, journey, key-events, scores
  webhook                                         Endpoints that receive identified visitors, moments, pages, clicks
  whoami           [options]                      Show the signed-in person and account

Docs: https://docs.sqid.dev   For agents: https://docs.sqid.dev/llms-full.txt
`;

export async function main(argv){
  let parsed = parseArgs(argv);
  let mode   = pickMode(parsed.flags);
  let out    = new Output(mode);
  let { command, args, flags } = parsed;

  if(flags.verbose){ process.env.SQID_DEBUG = '1'; }
  if(flags.version || flags.v){ out.text(version); out.json({ version }); return 0; }
  if(command === 'help'){ command = args.shift() || null; flags.help = true; }
  if(ALIASES[command]){ let [c, sub] = ALIASES[command]; command = c; args = [sub, ...args]; }

  if(!command){ out.text(USAGE); out.json({ usage : USAGE, commands : Object.keys(COMMANDS) }); return 0; }
  let loader = COMMANDS[command];
  if(!loader){
    return out.fail(usageError(`Unknown command "${command}".`, [{ command : 'sqid --help', description : 'List commands' }]));
  }
  let mod = await loader();
  if(flags.help || flags.h){ out.text(mod.help || USAGE); out.json({ command, help : mod.help || USAGE }); return 0; }

  try{
    flags = await expandInputJson(flags);
    let result = await mod.run({ args, flags, mode, out });
    out.result(result);
    return process.exitCode || 0;
  }catch(error){
    if(error instanceof CliError){ return out.fail(error); }
    return out.fail(new CliError('unexpected_error', error?.message || String(error), 'Run again with --verbose for the stack.', [], error));
  }
}
