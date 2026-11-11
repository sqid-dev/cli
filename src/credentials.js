// Where the token lives. v1: ~/.config/sqid/credentials.json, mode 0600
// (SQID_CONFIG_DIR overrides the folder). OS keychain comes later behind the
// same two functions. SQID_TOKEN in the environment wins over the file, so CI
// and containers never need a login.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const configDir = () => process.env.SQID_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'sqid');
const file = () => path.join(configDir(), 'credentials.json');

export async function readCredentials(){
  if(process.env.SQID_TOKEN){ return { source : 'env', access_token : process.env.SQID_TOKEN }; }
  try{
    let raw = await fs.readFile(file(), 'utf8');
    return { source : 'file', ...JSON.parse(raw) };
  }catch(error){
    if(error.code === 'ENOENT'){ return null; }
    throw error;
  }
}

export async function writeCredentials(creds){
  await fs.mkdir(configDir(), { recursive : true, mode : 0o700 });
  let tmp = file() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(creds, null, 2) + '\n', { mode : 0o600 });
  await fs.rename(tmp, file());
  return file();
}

export async function deleteCredentials(){
  try{ await fs.unlink(file()); return true; }
  catch(error){ if(error.code === 'ENOENT'){ return false; } throw error; }
}
