import { resolveSite, snippetFor } from '../project.js';

export const help = `sqid snippet [--site <id|name>]

Prints the install snippet for the site (from .sqid.json, --site, or the only site).
Paste it before </head> on every page; never hand-write it.
`;

export async function run({ flags }){
  let site = await resolveSite(flags);
  let snippet = snippetFor(site.id);
  return {
    data : { site : { id : site.id, name : site.name }, snippet },
    text : snippet,
    next : [{ command : 'sqid doctor', when : 'after the snippet is deployed' }]
  };
}
