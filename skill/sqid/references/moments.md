# Moments webhook (intent, for an agent)

Event `visitor.moment.created.v2`: `sqid webhook add <url> --event moment`.
A moment is one interpreted signal about one visitor at the time it is worth knowing,
with a verdict on whether to step in. Not every page view; the engine decides once per
shape and stays quiet until something new happens.

Exact shape for this site: `sqid webhook preview --event moment --json`. The record:

```json
{
  "type": "visitor.moment.created.v2",
  "data": {
    "moment": {
      "id": "<sdk>:<visitor>:<ts>",
      "kind": "form_stall",
      "decision": { "action": "engage", "mode": "support", "tier": "assist", "confidence": 0.8,
                    "why": "Filled three of five fields on the signup form and stopped.",
                    "instruction": "Offer to help with the signup form, in one line." },
      "reason": { "key": "form", "label": "Stuck in a form" },
      "page": { "path": "/signup", "title": "Sign up" },
      "session": { "age_s": 120, "page_count": 3, "pages": ["/", "/pricing", "/signup"], "device": "desktop", "source": "google" },
      "scores": { "frustration": 0.66, "friction": 0.5 },
      "created_at": "2026-11-06T14:25:05.000Z"
    },
    "visitor": { "id": "66f1c2d4e8a1b23456789abc", "identified": true },
    "sdk": { "id": "..." },
    "context": { "url": "https://example.com/signup", "page": "https://example.com/signup", "title": "Sign up", "referrer": "https://example.com/pricing" }
  }
}
```

## Fields to switch on

- `data.moment.kind`: `deliberation`, `high_intent_page`, `choosing_options`, `discount_codes`,
  `cart_stall`, `struggle`, `form_stall`, `churn_shape`, `settled_attention`, `other` (fixed set).
- `data.moment.decision.action`: `engage` (step in now; `mode` sales|support|retention,
  `tier` nudge|assist, `instruction` is a line written for an agent), `wait` (forming, do
  nothing visible), `quiet` (considered, stayed out). `mode`, `tier` and `instruction` are
  null unless the action is `engage`.
- `data.visitor.id`: joins to the identification record (`data.profile.id` there) and the
  visitor API. Look the person up by this id.
- `data.visitor.identified`: whether Sqid knows who the visitor is.

## Handler rules

- Every moment is delivered, whatever the verdict. React to `engage` only. Log `wait` and
  `quiet` if useful; never show them to the visitor.
- Dedupe on `data.moment.id`; a retry carries the same id.
- Pass `decision.instruction` to the agent as the thing to do. Do not recite the behavior
  back to the visitor ("I noticed you were on pricing"); the instruction is already
  phrased the right way.
- Verify the caller: create the endpoint with `--auth user:password` and check basic auth.
- Answer `2xx` quickly; do the agent call after responding.

## Minimal handler

```ts
// app/api/moments/route.ts
export async function POST(req: Request) {
  const event = await req.json();
  const m = event.data?.moment;
  if (!m || m.decision?.action !== "engage") return Response.json({ ok: true });
  if (await alreadySeen(m.id)) return Response.json({ ok: true });
  queueAgentTask({ visitorId: event.data.visitor.id, kind: m.kind, mode: m.decision.mode,
                   instruction: m.decision.instruction, page: m.page?.path });
  return Response.json({ ok: true });
}
```

Signals must be on for the site: `sqid signals on`. Use a live site; the Sandbox is for
identification, webhooks and the API.
The same moment also reaches the page as the `visitor.moment` engine event (see browser.md)
when the user wants to react in their own UI instead of through an agent.
Guide: https://docs.sqid.dev/guides/signals.md
