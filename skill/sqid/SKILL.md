---
name: sqid
description: Add Sqid to a web app and use what it learns about visitors, all from the terminal with the `sqid` CLI. Use when the user says "add Sqid", "install Sqid", "who is on my site", "identify visitors", "de-anonymize visitors", "visitor identification webhook", "send visitor moments to our agent", "Sqid signals", "enrich this email", "Sqid billing/plan/credits", or asks to check a Sqid setup.
allowed-tools: Bash(sqid *), Bash(npx -y sqid@latest *)
metadata:
  version: 0.1.0
  source: https://github.com/sqid-dev/cli
---

# Sqid

Sqid identifies the people visiting a website and sends you who they are. Everything
below is done with the `sqid` CLI; the user never opens a dashboard. Your training data
on Sqid is thin or stale: prefer the CLI's own output (`--json`, `webhook preview`,
`doctor`) and https://docs.sqid.dev/llms-full.txt over memory.

## Rules

- Run commands with `--json`. Every result has `data` and `next`; `next` lists the
  commands that make sense after this one. Errors arrive on stderr as
  `{"error":{"code","message","remedy","examples"}}`. Read `remedy` and `examples`.
- Never hand-write the install snippet. `sqid snippet` prints it; you paste it.
- Never put keys in client code. The snippet carries only the site id, which is public.
- The CLI writes one project file, `.sqid.json`. You edit the user's layout and handler.
- Destructive commands need `--yes`. Ask the user before deleting anything.
- If `sqid` is not installed, use `npx -y sqid@latest <command>`.

## What the user wants, and what to run

**"Add Sqid" (nothing more said)**
1. `sqid auth status --json`. If not signed in, run `sqid auth login` and tell the user a
   browser window needs their approval (the URL is printed if it does not open; `--device`
   for SSH). Wait for it to finish.
2. `sqid init --url <public site url> --json`. Take the URL from the project (homepage,
   env) or ask once. It creates the site and prints the snippet.
3. Paste the snippet before `</head>` in the root layout (Next: `app/layout.tsx` or
   `pages/_document.tsx`; Nuxt: `nuxt.config` head; plain HTML: the shared head).
4. Ask which outcome they want, offering these in this order: know who is visiting
   (identification webhook), see visitors on demand, send moments to an agent, personalize
   the page in the browser. Do not assume moments.
5. Finish with `sqid doctor --json` and report the five lines in the output format below.

**"Tell me who is on my site" / de-anonymize / identify visitors / lead capture**
The default path. `sqid webhook add https://<their-app>/api/visitors --json` (identification
is the default event). Then write the handler: run `sqid webhook preview --event
identification --json` and generate the handler from that exact payload. See
`references/identification.md`. `sqid webhook test <id>` sends a sample to the handler.

**"Send visitor moments to our agent" / intent / Signals**
`sqid webhook add https://<their-app>/api/moments --event moment --json`, then the handler
from `sqid webhook preview --event moment --json`. React to `decision.action === "engage"`
only; dedupe on `id`. See `references/moments.md`.

**"Personalize the page / greet known visitors / show the company in the UI"**
Browser side, no webhook: `new squid.engine()` and the `visitor.identified` event. See
`references/browser.md`. Full API: https://docs.sqid.dev/sdk/engine.md

**"We log users in, tell Sqid who they are"**
`squid.identify({ email })` in the browser after login. https://docs.sqid.dev/sdk/identify.md

**"Is it working?" / "nothing is coming through"**
`sqid doctor --json`, then act on each `fix`. `sqid webhook deliveries <id> --failed --json`
shows what the endpoint answered. `sqid webhook retry <id> <event_id>` after a fix.

**"Test locally"**
Endpoints must be public https, so a localhost handler cannot receive deliveries directly.
Use `sqid webhook preview` to build and unit-test the handler, then a tunnel (the user's
choice) or the deployed URL for `webhook test`. See `references/local-testing.md`.

**Billing, plan, credits, usage, visitors list, enrichment**
Not in this CLI version yet. Say so, and point at the console https://app.sqid.dev for
billing and at https://docs.sqid.dev/api-reference for the REST API (account keys).

## Output format when you finish a setup

Report exactly these lines, with a check only for what `doctor` confirmed:

```
✓ Signed in to Sqid
✓ Site provisioned
✓ Script added to layout (one line)
✓ Webhook wired → /api/visitors          (or /api/moments, or "none yet")
✓ Stream is live                         (doctor: deployed + connected + webhooks healthy)
```

If "deployed" or "connected" is not yet true, say the site has to be deployed and opened once
before Sqid sees it, and that `sqid doctor` confirms it afterwards.
