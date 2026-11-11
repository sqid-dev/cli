import { usageError } from '../../errors.js';

export const help = `Usage: sqid auth <command>

Manage authentication.

Commands:
  login   [--device] [--no-browser] [--force]   Sign in or sign up in your browser (aliases: sqid login, signin, signup)
  logout  [--yes]                                Revoke this machine's token and forget it (alias: sqid logout)
  status                                         Whether this machine is signed in, and as whom
`;

export async function run(ctx){
  let [sub, ...rest] = ctx.args;
  if(sub === 'login' || sub === 'signin' || sub === 'signup' || sub === 'sign-in'){ return (await import('./login.js')).run({ ...ctx, args : rest }); }
  if(sub === 'logout' || sub === 'signout' || sub === 'sign-out'){ return (await import('./logout.js')).run({ ...ctx, args : rest }); }
  if(sub === 'status' || !sub){ return (await import('./status.js')).run({ ...ctx, args : rest }); }
  throw usageError(`auth: unknown subcommand "${sub}".`, [{ command : 'sqid auth login', description : 'Sign in' }, { command : 'sqid auth status', description : 'Check the stored session' }]);
}
