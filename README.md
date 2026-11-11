# sqid

The Sqid command-line interface.

## Add Sqid to an app

```sh
npx -y sqid-cli init
```

On npm the package is `@sqid-dev/sqid`, with `sqid-cli` as an alias of it; either one
installs the `sqid` command. (npm refuses the bare name `sqid` as too close to `uuid`.)

`sqid init` is the setup path for developers and coding agents. It signs you in
through your browser the first time, creates a site for the project, and prints
the one script tag your layout needs. You never open a dashboard.

In Claude Code the whole flow is one line:

```
> Add Sqid to our app and tell us who is visiting.

  ✓ Signed in to Sqid
  ✓ Site provisioned
  ✓ Script added to layout (one line)
  ✓ Webhook wired → /api/visitors   (each identified visitor, full record)
  ✓ Stream is live
```

Ask for moments instead ("send visitor moments to our agent") and the webhook is
wired to `/api/moments` with `--event moment`. Both can run side by side.

What `sqid init` changes:

- Creates a site on your Sqid account (starting the free Developer plan first
  when the account has none; no card).
- Writes `.sqid.json` in the project root with the site id. That is the only
  project file the CLI ever writes. It never edits your layout, `CLAUDE.md`,
  `AGENTS.md` or `.mcp.json`; the agent (or you) pastes the snippet it prints.

After setup, run `sqid doctor` to verify the integration:

```sh
npx -y sqid-cli doctor
```

## Installation

### npm

```sh
npm install -g sqid-cli      # or @sqid-dev/sqid
```

Node 18.17 or newer. No other dependencies.

## Usage

```
Usage: sqid [options] [command]

Sqid CLI

Options:
  -h, --help           Display help for command
  --input-json <json>  Pass command options as a JSON string, @file.json, or -
                       for stdin
  --json               Emit JSON on stdout (default when stdout is not a TTY)
  --mode <mode>        Force interaction mode (human or agent). Also settable
                       via the SQID_MODE environment variable. Defaults to
                       agent when run without a TTY.
  --site <id|name>     Which site a command acts on (default: .sqid.json, or
                       the only site)
  -v, --version        Output the version number
  --verbose            Show detailed output (enables debug messages)
  --yes                Confirm destructive commands without a prompt

Commands:
  auth                                            Manage authentication (login, logout, status)
  billing                                         Status, card (browser), top-up, auto-reload, invoices
  cap              [options]                      Identification cap for the site
  doctor           [options]                      Check this project's Sqid integration health
  enrich           [options]                      Look a person up by email, phone or LinkedIn URL
  help             [command]                      Display help for command
  init             [options]                      Create a site for this project and print the snippet
  keys                                            SDK keys for the site (the REST visitor API)
  logs                                            API calls and webhook deliveries
  moments                                         What Signals decided: list, get, tail
  plan                                            Show or change the plan; buy OEM credit packs
  signals                                         Signals on, off or status for the site
  sites                                           List the sites on this account
  skill                                           Install the Claude Code skill for this CLI globally
  snippet          [options]                      Print the install snippet for the site
  usage            [options]                      Identifications billed this month, per site
  visitors                                        Identified visitors: list, get, journey, key-events, scores
  webhook                                         Endpoints that receive identified visitors, moments, pages, clicks
  whoami           [options]                      Show the signed-in person and account
```

`sqid login` and `sqid logout` are shorthands for `sqid auth login` and `sqid auth logout`.

## The skill

`sqid skill install` copies the bundled Claude Code skill (`skill/sqid/`) into
`~/.claude/skills/sqid` (and the Codex, Cursor or `.agents` folders when they exist).
It is about two pages, organised by what the user asks for, and it names the command
for each ask. It is installed globally, never into your repository. `sqid skill show`
prints it.

## Authentication

`sqid auth login` runs an OAuth 2.0 PKCE flow against Sqid's identity provider: a
one-shot listener on `127.0.0.1`, your browser, the consent screen, and the code
exchanged in the terminal. Passwords never pass through the CLI. `--device` prints
a URL and a code instead, for SSH sessions and containers. `--no-browser` only
prints the URL.

The access token lasts one day and refreshes itself while you keep using the CLI.
Credentials live in `~/.config/sqid/credentials.json` (mode 0600; `SQID_CONFIG_DIR`
moves the folder). `SQID_TOKEN` in the environment overrides the file, for CI.
`sqid auth logout` revokes the grant and deletes the file.

## Agent mode

With no TTY, with `--json`, or with `SQID_MODE=agent`, every command prints one
JSON document on stdout with `data` and `next` (the commands that make sense to
run after this one). Errors go to stderr as JSON:

```json
{"error":{"code":"not_signed_in","message":"No Sqid credentials on this machine.","remedy":"Sign in first.","examples":[{"command":"sqid auth login","description":"Sign in with your browser"}]}}
```

Exit codes: `0` ok, `1` failure, `2` usage error, `3` not signed in. Destructive
commands need `--yes` in agent mode. Prompts never block: anything that would ask
is refused with the flag that answers it.

## Telemetry

None. The CLI sends nothing but the API calls you ask for.

## Docs

- Product docs: https://docs.sqid.dev
- Full docs in one file for agents: https://docs.sqid.dev/llms-full.txt
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

MIT
