// Human mode: short text on stdout. Agent mode: one JSON document on stdout,
// errors as JSON on stderr. Mode = --mode, else SQID_MODE, else --json, else TTY.

export function pickMode(flags){
  let forced = flags.mode || process.env.SQID_MODE;
  if(forced === 'agent' || forced === 'human'){ return forced; }
  if(flags.json){ return 'agent'; }
  return process.stdout.isTTY ? 'human' : 'agent';
}

export const isAgentHarness = () => !!(process.env.CLAUDECODE || process.env.CLAUDE_CODE || process.env.CURSOR_TRACE_ID || process.env.CODEX_SANDBOX);

export class Output {
  constructor(mode){ this.mode = mode; }
  get agent(){ return this.mode === 'agent'; }

  // Progress lines for a person; agents get nothing on stdout until the result.
  note(line){ if(!this.agent){ process.stderr.write(line + '\n'); } }
  text(s){ if(!this.agent){ process.stdout.write(s.endsWith('\n') ? s : s + '\n'); } }
  json(obj){ if(this.agent){ process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); } }

  // { data, next, text } from a command.
  result(r){
    if(!r){ return; }
    if(this.agent){
      this.json({ ok : true, ...(r.data !== undefined ? { data : r.data } : {}), ...(r.next?.length ? { next : r.next } : {}) });
    } else {
      if(r.text){ this.text(typeof r.text === 'function' ? r.text(r.data) : r.text); }
      else if(r.data !== undefined){ this.text(JSON.stringify(r.data, null, 2)); }
      if(r.next?.length){ this.text('\nNext:\n' + r.next.map(n => `  ${n.command}${n.when ? '   # ' + n.when : ''}`).join('\n')); }
    }
  }

  fail(error){
    if(this.agent){
      process.stderr.write(JSON.stringify({ error : error.toJSON() }) + '\n');
    } else {
      process.stderr.write(`sqid: ${error.message}\n`);
      if(error.remedy){ process.stderr.write(`  ${error.remedy}\n`); }
      for(let ex of error.examples || []){ process.stderr.write(`  ${ex.command}   # ${ex.description}\n`); }
      if(process.env.SQID_DEBUG && error.cause?.stack){ process.stderr.write(error.cause.stack + '\n'); }
    }
    return error.exit || 1;
  }
}
