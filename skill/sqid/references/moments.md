# Moments webhook (intent, for an agent)

Event `visitor.moment.created.v2`: `sqid webhook add <url> --event moment`.
A moment is one interpreted signal about one visitor at the time it is worth knowing,
with a verdict on whether to step in. Not every page view; the engine decides once per
shape and stays quiet until something new happens.

Exact shape for this site: `sqid webhook preview --event moment --json`. The record:

```json
{
  "id": "<sdk>:<visitor>:<ts>",
  "namespace": "visitor.moment.created",
  "created_at": "2026-11-06T14:25:05.000Z",
  "site": { "sdk_id": "...", "name": "..." },
  "data": {
    "moment": {
      "kind": "form_stall",
      "group": "friction",
      "decision": { "action": "engage", "mode": "support", "tier": "assist", "confidence": 0.8,
                    "why": "Filled three of five fields on the signup form and stopped.",
                    "instruction": "Offer to help with the signup form, in one line." },
      "reason": "Stuck in a form",
      "page": "/signup",
      "scores": { "frustration": 0.66, "friction": 0.5 },
      "session": { "age_s": 120, "page_count": 3, "pages": ["/", "/pricing", "/signup"], "device": "desktop", "source": "google" }
    },
    "visitor": { "id": "66f1c2d4e8a1b23456789abc", "identified": true },
    "profile": { "name": "Jane Park", "company": "Northwind", "title": "VP Operations" }
  }
}
```

## Fields to switch on

- `data.moment.kind`: `deliberation`, `high_intent_page`, `cart_stall`, `struggle`,
  `form_stall`, `churn_shape`, `other` (fixed set; `group` is buying, friction, churn, other).
- `data.moment.decision.action`: `engage` (step in now; `mode` sales|support|retention,
  `tier` nudge|assist, `instruction` is a line written for an agent), `wait` (forming, do
  nothing visible), `quiet` (considered, stayed out).
- `data.visitor.id`: joins to the identification record and the visitor API.
- `data.profile`: `null` for anonymous visitors.

## Handler rules

- React to `engage` only. Log `wait` and `quiet` if useful; never show them to the visitor.
- Dedupe on `id`; a retry carries the same id.
- Pass `decision.instruction` to the agent as the thing to do. Do not recite the behavior
  back to the visitor ("I noticed you were on pricing"); the instruction is already
  phrased the right way.
- Answer `2xx` quickly; do the agent call after responding.

## Minimal handler

```ts
// app/api/moments/route.ts
export async function POST(req: Request) {
  const event = await req.json();
  const m = event.data?.moment;
  if (!m || m.decision?.action !== "engage") return Response.json({ ok: true });
  if (await alreadySeen(event.id)) return Response.json({ ok: true });
  queueAgentTask({ visitorId: event.data.visitor.id, kind: m.kind, mode: m.decision.mode,
                   instruction: m.decision.instruction, page: m.page, profile: event.data.profile });
  return Response.json({ ok: true });
}
```

Signals must be on for the site; if `webhook preview --event moment` or the console says
it is off, tell the user it is enabled per site in the console (CLI `signals on` comes later).
Guide: https://docs.sqid.dev/guides/signals.md
