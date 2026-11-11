# Contributing

Open an issue before a change larger than a bug fix, so we can agree on the shape first.

## Developing locally

Prerequisites: Node 18.17 or newer, Git. No other tooling.

```sh
git clone https://github.com/sqid-dev/cli
cd cli
node bin/sqid.js --help
npm test
```

There is no build step and no dependency install. To run the checkout as the
global `sqid` command: `npm link`.

Point the CLI at another environment with `SQID_API` (API origin),
`SQID_OAUTH_ISSUER` and `SQID_OAUTH_CLIENT_ID` (identity provider), and
`SQID_CONFIG_DIR` (where credentials are kept) so a test login never touches your
real session.

## Pull requests

- One change per PR, with a test in `test/`.
- Keep `USAGE` in `src/index.js` and the Usage block in `README.md` identical.
- Follow `AGENTS.md` for command conventions (agent mode, error codes, `next`).
- Plain commit messages. No trailers.

## Reporting a problem

Open an issue with the command you ran, `--verbose` output with secrets removed,
and the Node version.
