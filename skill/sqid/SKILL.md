---
name: sqid
description: Add Sqid to a web app and use what it learns about visitors, all from the terminal with the `sqid` CLI. Use when the user says "add Sqid", "set up Sqid", "install Sqid", "try Sqid", "who is on my site", "identify visitors", "de-anonymize visitors", "visitor identification webhook", "send visitor moments to our agent", "Sqid signals", "enrich this email", "Sqid billing/plan/credits", or asks to check a Sqid setup.
allowed-tools: Bash(sqid *), Bash(npx -y @sqid-dev/sqid *), Bash(npx -y sqid-cli *)
metadata:
  version: 0.1.4
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
- If `sqid` is not installed, use `npx -y @sqid-dev/sqid <command>`.

## What the user wants, and what to run

**"Add Sqid" / "set up Sqid" (nothing more said): the guided setup**
One question at a time, multiple choice (in Claude Code, ask it so it renders as a
multiple-choice question), each with a default ("say 'not sure' and I'll pick
X"). At most three questions in all. Never ask what you can detect. Say what will change
before any write, naming the file for a code edit; after each step, one line saying what
happened. Never ask for a card number, password or key in chat (`sqid billing card` opens
the browser); if someone pastes a key, do not use it and tell them to delete it.

Already set up? If the project has `.sqid.json` or a layout already contains
`app.asksquid.ai/tfs/`, or `sqid sites list` shows a site for this address, do not run
`init` again or paste a second snippet: say what you found, run `sqid doctor --json`, and
continue from whatever is missing.

1. Detect, do not ask. `sqid auth status --json`; if not signed in, `sqid auth login` and tell
   the user a browser window needs their approval (`--device` for SSH). Then `sqid whoami
   --json`, `sqid sites list --json`, `sqid billing status --json`. From the open project,
   if any: the site URL (package.json `homepage`, `SITE_URL` / `NEXT_PUBLIC_SITE_URL`-style env
   vars, `vercel.json`, `CNAME`, wrangler config), the framework and the root layout file.
2. Read the person's skill level from what you see. A repo with a framework open and technical
   wording: terse, code-first. No repo, or plain wording ("my website"): plain language, gloss
   jargon once ("a webhook, meaning Sqid sends each identified visitor to a web address you
   own"), make the code edits yourself, and show visitors in chat (`sqid visitors list`) before
   suggesting a webhook. Ask "Will you be writing code, or should I handle it?" only when the
   signals conflict.
3. Open with the goal question, after a plan line and a sites line taken from step 1 (never
   invent a balance or welcome state):
   "You're signed in to Sqid. {plan line} {sites line}. One question to pick the right path:
   what do you want Sqid to do?
    (a) Show me who's visiting my website
    (b) Add visitor identification to a product I sell to other businesses
    (c) Just let me see it work first
   Say 'not sure' and I'll start with (c)."
   Plan line example: "You're on Developer: pay as you go, $0.25 per identified visitor, with
   25 free credits once you add a card."

**(a) Show me who's visiting my website**
- Second question only if no URL was detected: "Which website should we start with? You can add
  more later." If one was: "I found example.com in this project. Set that up?" (yes / another site).
- If a website project is open, go straight to the real site. If not, third question: "What is
  your website built with?" (WordPress / Shopify / Squarespace / Wix / Webflow / something else
  or not sure / I'd rather try a test version first). The test version is `sqid playground`.
- Real site: `sqid init --url <url> --json` creates the site (it adds the www. or bare twin of
  the address itself) and prints the snippet. Paste it before `</head>` in the root layout
  (Next: `app/layout.tsx` or `pages/_document.tsx`; Nuxt: `nuxt.config` head; plain HTML: the
  shared head). On a website builder, give that builder's steps from
  https://docs.sqid.dev/sdk/installation#on-a-website-builder one per line, and wait while they
  paste and publish. Add any other address it runs on (staging, a second domain) with
  `sqid sites origins --add`.
- Then the outcome, by skill level: developers get the identification webhook (the next
  section) built from `sqid webhook preview`; others see visitors with `sqid visitors list`
  first, and a webhook only if they have an endpoint. Do not assume moments.
- Plan: recommend, do not ask. Developer fits: $0.25 a credit, 25 welcome credits once a card
  is added (`sqid billing card`).
- Finish with `sqid doctor --json` and report the five lines in the output format below.

**(b) Embed in a product I sell (OEM)**
- Second question: "Roughly how many customer sites will use it?" (1-10 / 10-100 / more than
  100 or custom terms).
- Recommend, do not ask: OEM Launch ($675/month, 500 identifications a month included, credit
  packs after: 1,000 for $200, 5,000 for $900, 10,000 for $1,700, 25,000 for $4,000) for 1 to
  100 customer sites; Enterprise ("talk to us" at help@asksquid.ai, a custom plan) for more than 100 or custom terms. Suggest seeing
  it work in the Sandbox first (`sqid playground`).
- The upgrade is owner only and needs a card. Never upgrade without an explicit yes; then
  `sqid plan set oem --accept-terms` (it accepts the OEM Launch addendum,
  https://sqid.dev/oem-launch-terms.html) or the console's billing page.
- Then the same site steps as (a) for their first customer site or the Sandbox, and point at
  https://docs.sqid.dev/api-reference for embedding.

**(c) Just let me see it work first** (also: no website, or "try", "test", "demo", "playground")
- Before it opens, say what to look at: "You'll appear as an anonymous visitor, then as a person
  within a couple of seconds." Then `sqid playground` (Driftwood, a demo site on
  http://localhost:3000 with a Sqid panel; uses their sign-in and the Sandbox, no credits). Point
  at the panel on the right: it shows "Anonymous", then a name, title and company.
- After: offer "Put Sqid on my site", which is branch (a).

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
The Sandbox site identifies every new visitor as one of 50 made-up people, spends no credits
and never produces moments. Allow the dev server on it with `sqid sites origins --sandbox --add
http://localhost:3000`, paste `sqid snippet --site Sandbox` into the page. Endpoints must be
public https, so a localhost handler cannot receive deliveries directly: build and unit-test
the handler from `sqid webhook preview`, then a tunnel (the user's choice) or the deployed URL
for `webhook test`. See `references/local-testing.md`.

**"Who has been on the site?" / "find visitors from <company>" (on demand, no webhook)**
`sqid visitors list --json` (newest identified first; `--search acme` matches name, company
or email prefixes; `--all-sites`). `sqid visitors get <id> --json` for the full profile,
`journey`, `key-events`, `scores` for what they did. Ids match webhook `visitor.id`.

**"Enrich this email / phone / LinkedIn"**
`sqid enrich --email jane@acme.com --json` (or `--phone`, `--linkedin`). The first run
creates an SDK key for the site named "CLI on <hostname>". No match answers "no match (no
credit used)"; enrichment is refused on the Sandbox. For the user's own backend,
`sqid keys create --name Production` and the REST API https://docs.sqid.dev/api-reference.

**"Turn on Signals" / "no moments are coming"**
`sqid signals status --json`, then `sqid signals on`. `sqid moments list --decision engage --json`
shows recent ones; `sqid moments tail` follows them live.

**Billing: "add a card", "what's left", "upgrade", "cap spend"**
`sqid billing status --json` (plan, card, balance, this month). `sqid billing card` opens the
browser; never ask for card numbers. `sqid plan show` for the plan and renewal. `sqid plan set oem
--accept-terms` upgrades to OEM Launch (only on an explicit yes from the owner; tell the user it
accepts the OEM Launch addendum and charges $675/month for 500 identifications a month);
`sqid plan packs buy 5000` buys OEM credits; `sqid billing topup 20` on Developer only ($0.25 a
credit). If a payment needs the bank's confirmation, the CLI prints the console billing page.
`sqid cap set 5000` limits identifications per site; `sqid usage --json` shows the month. `sqid logs api --failed` and `sqid logs webhooks
--failed` for failures.

## Output format when you finish a setup

Report exactly these lines (the same ones the MCP setup and the docs use), with a check only for
what actually happened; `doctor` decides the last one:

```
✓ Signed in to Sqid
✓ Site set up
✓ Snippet added                          (the file it went into)
✓ Visitors showing, or webhook wired     (→ /api/visitors, or "none yet")
✓ Stream is live                         (doctor: deployed + connected + webhooks healthy)
```

Then at most two next things, if anything is pending. If "deployed" or "connected" is not yet
true: publish the site and open it once, then run `sqid doctor`. Close with how to come back:
"Ask me 'is Sqid working?' any time." 
