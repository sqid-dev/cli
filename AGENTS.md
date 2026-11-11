# AGENTS.md

Conventions for anyone (person or agent) changing this repo.

## Shape

Plain Node (18.17+), ES modules, **no runtime dependencies**. One package, no
build step, no TypeScript. Published as `@sqid-dev/sqid` (npm refuses the bare name `sqid` as too similar to
`uuid`/`ulid`); the installed command is `sqid`. `bin/sqid.js` calls `main()` in `src/index.js`.

- `src/index.js` — argv in, command out. Holds the `USAGE` text and the alias table.
- `src/args.js` — flag parsing and `--input-json`.
- `src/output.js` — human vs agent output, the error envelope.
- `src/errors.js` — `CliError(code, message, remedy, examples, cause, exit)`.
- `src/oauth.js` — PKCE loopback, device flow, refresh, revoke. Discovery at runtime.
- `src/credentials.js` — the credentials file. `SQID_TOKEN` wins over it.
- `src/api.js` — authenticated calls to `app.sqid.dev` with silent refresh.
- `src/project.js` — `.sqid.json`, site resolution, the snippet template.
- `src/commands/<name>.js` or `src/commands/<group>/index.js` — one command each.

## Adding a command

1. Create `src/commands/<name>.js` exporting `help` (a string, Clerk-style usage) and
   `run({ args, flags, mode, out })`.
2. Return `{ data, text, next }`: `data` is what agents get, `text` (string or
   function of data) is what people get, `next` is `[{ command, when }]`.
3. Throw `CliError` for anything the caller can act on. Give it a stable snake_case
   `code`, a `remedy`, and runnable `examples`. Usage errors exit 2, missing sign-in
   exits 3.
4. Register it in `COMMANDS` in `src/index.js` and add a line to `USAGE` and to the
   Usage block in `README.md` (they must stay identical; `test/cli.test.js` checks the
   first line).
5. Agent mode is the default without a TTY. Never prompt: refuse with the flag that
   answers. Destructive commands require `--yes` in agent mode.
6. Write the project file only through `src/project.js`; never touch other files in
   the user's repo.
7. Add an offline test. The fake issuer in `test/cli.test.js` covers OAuth; stub
   `SQID_API` with a local `http.createServer` for API calls.

## Checks before a PR

```sh
npm test            # node --test, offline, about ten seconds
node bin/sqid.js --help
```

## Facts worth knowing

- The OAuth client id in `src/meta.js` is public by design (PKCE, no secret).
- Scopes are `email profile offline_access`; `openid` is refused by the provider.
- Access tokens are one-day JWTs; the CLI trusts the `exp` claim, not `expires_in`.
- The server side (what accepts the token) lives in the private platform repo. Nothing
  about it belongs here beyond the routes the CLI calls.
- Commit messages: plain, no co-author trailers.
