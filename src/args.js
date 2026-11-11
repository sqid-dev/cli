// Tiny argv parser: first bare word is the command, the rest are positional args;
// --flag, --flag value, --flag=value, --no-flag, -h. No dependency.

const TAKES_VALUE = new Set(['mode', 'api', 'site', 'input-json', 'name', 'url', 'event', 'auth', 'role', 'search', 'custom-id', 'email', 'phone', 'linkedin']);

export function parseArgs(argv){
  let command = null, args = [], flags = {};
  for(let i = 0; i < argv.length; i++){
    let a = argv[i];
    if(a === '--'){ args.push(...argv.slice(i + 1)); break; }
    if(a.startsWith('--')){
      let [key, inline] = a.slice(2).split(/=(.*)/s);
      if(key.startsWith('no-') && inline === undefined){ flags[key.slice(3)] = false; continue; }
      if(inline !== undefined){ flags[key] = inline; continue; }
      if(TAKES_VALUE.has(key) && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')){ flags[key] = argv[++i]; continue; }
      flags[key] = true;
      continue;
    }
    if(a.length === 2 && a[0] === '-' && /[a-z]/i.test(a[1])){ flags[a[1]] = true; continue; }
    if(command === null){ command = a; } else { args.push(a); }
  }
  return { command, args, flags };
}
