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

// --input-json '{"url":"https://x.test","once":true}' | @file.json | - (stdin).
// Flat object only. Keys map camelCase/snake_case -> kebab flags. Explicit flags win.
export async function expandInputJson(flags){
  let raw = flags['input-json'];
  if(raw === undefined){ return flags; }
  const { CliError } = await import('./errors.js');
  let text;
  try{
    if(raw === '-'){ text = await new Promise((res, rej) => { let b = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => b += d).on('end', () => res(b)).on('error', rej); }); }
    else if(typeof raw === 'string' && raw.startsWith('@')){ text = await (await import('node:fs/promises')).readFile(raw.slice(1), 'utf8'); }
    else { text = String(raw); }
  }catch(error){ throw new CliError('invalid_json', `Could not read --input-json: ${error.message}`, '', [], error, 2); }
  let obj;
  try{ obj = JSON.parse(text); }catch(error){ throw new CliError('invalid_json', `--input-json is not valid JSON: ${error.message}`, 'Pass a flat JSON object.', [{ command : `sqid init --input-json '{"url":"https://example.com"}'`, description : 'Inline JSON' }], error, 2); }
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)){ throw new CliError('invalid_json', '--input-json must be a flat JSON object.', '', [], undefined, 2); }
  let out = {};
  for(let [k, v] of Object.entries(obj)){
    if(v && typeof v === 'object' && !Array.isArray(v)){ throw new CliError('invalid_json', `--input-json key "${k}" is nested; only flat values are accepted.`, '', [], undefined, 2); }
    if(v === false || v === null){ continue; }
    let key = k.replace(/_/g, '-').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    out[key] = Array.isArray(v) ? v.join(',') : v;
  }
  let { 'input-json' : _, ...explicit } = flags;
  return { ...out, ...explicit };
}
