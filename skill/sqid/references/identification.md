# Identification webhook (who is on the site)

Event `visitor.identification.created.v2`, the CLI's default for `sqid webhook add`.
Fires when Sqid identifies a visitor. One HTTPS POST per identification, JSON body.

## Get the exact shape from the CLI, not from here

```
sqid webhook preview --event identification --json
```

returns `data.payload`: the complete sample record for this site. Generate the
handler's types and tests from that output. The body is `{ "type", "data" }`:

- `type`: `visitor.identification.created.v2`
- `data.profile`: `id` (the Sqid visitor id), `alias`, `email`
- `data.traits`: names, work and personal emails, phones, gender, birth year
- `data.social`: LinkedIn, Facebook, X, GitHub (`url`, `username`)
- `data.company` and `data.organization`: name, size, industry, website, revenue, location
- `data.job`: title, role, seniority, departments
- `data.location`, `data.location_names`, `data.street_addresses`, `data.regions`
- `data.experience`, `data.interests`, `data.skills`
- `data.device.type`

`data.profile.id` is the same id moments carry as `visitor.id` and the visitor API takes,
so store it as the join key. A delivery from a Sandbox site has one extra top-level field,
`"sandbox": true`.

## Handler rules

- Answer `2xx` fast, then process. Each delivery is attempted once and logged; a failed one
  can be re-sent with `sqid webhook retry <id> <event_id>`. Sqid turns an endpoint off after
  repeated failures; `sqid webhook enable <id>` turns it back on.
- Make the handler safe to run twice: dedupe on `data.profile.id` plus the day, or upsert.
- Verify the caller: create the endpoint with `--auth user:password` and check HTTP basic
  auth in the handler.
- The endpoint must be a public https URL; localhost is refused.
- Store `data.profile.id` and the email; everything else can be re-read later from the
  visitor API with an SDK key (https://docs.sqid.dev/api-reference/visitors/get-details.md).

## Minimal handler (Next.js route handler)

```ts
// app/api/visitors/route.ts
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Basic " + btoa(`${process.env.SQID_WEBHOOK_USER}:${process.env.SQID_WEBHOOK_PASS}`)) {
    return new Response("unauthorized", { status: 401 });
  }
  const event = await req.json();                 // shape: sqid webhook preview --event identification
  if (event.type !== "visitor.identification.created.v2") return Response.json({ ok: true });
  await upsertVisitor({ visitorId: event.data.profile.id, email: event.data.profile.email, record: event.data });
  return Response.json({ ok: true });
}
```

Then: `sqid webhook add https://<app>/api/visitors --auth "$SQID_WEBHOOK_USER:$SQID_WEBHOOK_PASS"`
and `sqid webhook test <id>` to see the handler's answer.

## v1 identification

`--event identification-v1` sends the older, section-based payload (`visitor.identification.created`:
traits, social, company, job on by default; context, location, experience optional). Use it only
to match an existing integration.
