// One error shape for humans and agents:
//   code      stable, snake_case; agents switch on it
//   message   what went wrong
//   remedy    what to do about it
//   examples  [{ command, description }] the agent can run next
// Exit codes: 1 failure, 2 usage error, 3 not signed in.

export class CliError extends Error {
  constructor(code, message, remedy = '', examples = [], cause = undefined, exit = 1){
    super(message);
    this.code     = code;
    this.remedy   = remedy;
    this.examples = examples;
    this.cause    = cause;
    this.exit     = exit;
  }
  toJSON(){
    return { error : this.code, message : this.message, remedy : this.remedy || undefined, examples : this.examples?.length ? this.examples : undefined };
  }
}

export const usageError  = (message, examples = []) => new CliError('usage', message, 'Check the command and its flags.', examples, undefined, 2);
export const notSignedIn = () => new CliError('not_signed_in', 'No Sqid credentials on this machine.', 'Sign in first.', [
  { command : 'sqid login',          description : 'Sign in with your browser' },
  { command : 'sqid login --device', description : 'Sign in from another device (SSH, containers)' }
], undefined, 3);
