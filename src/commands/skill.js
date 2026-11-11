// The Claude Code skill ships inside this package. `skill install` copies it to the
// user's global skills folder(s) so every project gets it; it never writes into the
// current repo. `skill path` prints where the bundled copy lives (for `npx skills add`
// style tooling or manual copies).

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { usageError } from '../errors.js';

const BUNDLED = fileURLToPath(new URL('../../skill/sqid/', import.meta.url));

// Where agents look for global skills. Claude Code first; others when their folder exists.
function targets(){
  let home = os.homedir();
  let all = [
    { agent : 'claude',  dir : path.join(home, '.claude', 'skills', 'sqid'),  always : true },
    { agent : 'codex',   dir : path.join(home, '.codex', 'skills', 'sqid'),   always : false },
    { agent : 'cursor',  dir : path.join(home, '.cursor', 'skills', 'sqid'),  always : false },
    { agent : 'agents',  dir : path.join(home, '.agents', 'skills', 'sqid'),  always : false }
  ];
  return all;
}

async function exists(p){ try{ await fs.access(p); return true; }catch(e){ return false; } }

async function copyDir(src, dst){
  await fs.mkdir(dst, { recursive : true });
  for(let e of await fs.readdir(src, { withFileTypes : true })){
    let s = path.join(src, e.name), d = path.join(dst, e.name);
    if(e.isDirectory()){ await copyDir(s, d); } else { await fs.copyFile(s, d); }
  }
}

export const help = `Usage: sqid skill <command>

The Claude Code skill that teaches an agent how to use this CLI.

Commands:
  install [--agent claude|codex|cursor|agents|all]   Copy the skill into the global skills folder (default: Claude Code, plus any other agent folder that already exists)
  path                                               Print the bundled skill's folder
  show                                               Print SKILL.md
`;

export async function run({ args, flags }){
  let sub = args[0] || 'install';
  if(sub === 'path'){ return { data : { path : BUNDLED }, text : BUNDLED }; }
  if(sub === 'show'){ let md = await fs.readFile(path.join(BUNDLED, 'SKILL.md'), 'utf8'); return { data : { skill : md }, text : md }; }
  if(sub !== 'install'){ throw usageError(`skill: unknown subcommand "${sub}".`, [{ command : 'sqid skill install', description : 'Install the skill globally' }]); }

  let want = flags.agent ? String(flags.agent) : null;
  let installed = [];
  for(let t of targets()){
    let pick = want === 'all' || want === t.agent || (!want && (t.always || await exists(path.dirname(path.dirname(t.dir)))));
    if(!pick){ continue; }
    await copyDir(BUNDLED, t.dir);
    installed.push({ agent : t.agent, path : t.dir });
  }
  return {
    data : { installed },
    text : installed.map(i => `Installed the sqid skill for ${i.agent}: ${i.path}`).join('\n') || 'Nothing installed.',
    next : [{ command : 'sqid init', when : 'to set this project up (the agent now knows the commands)' }]
  };
}
