# Identification webhook (who is on the site)

Event `visitor.identification.created.v2`, the CLI's default for `sqid webhook add`.
Fires once per visitor Sqid identifies. One HTTPS POST per identification, JSON body.

## Get the exact shape from the CLI, not from here

```
sqid webhook preview --event identification --json
```

returns `data.payload`: the complete sample record for this site. Generate the
handler's types and tests from that output. Top-level sections of the record:

- `person`: names, emails, phones
- `social`: LinkedIn, X, GitHub, Facebook profiles
- `company` and `organization`: name, domain, industry, size
- `job`: title, seniority, role
- `location` and `addresses`
- `experience`, `interests`, `skills`
- `device`: browser, OS, device type
- `visitor.id`: the profile id. It is the same id used by moments and the visitor API,
  so store it as the join key.

The envelope around the record carries `id` (stable per event; a retry repeats it),
`namespace`, `created_at` and `site.sdk_id`.

## Handler rules

- Answer `2xx` fast, then process. Sqid turns an endpoint off after repeated failures
  (5 permanent-error failures in a row, 10 temporary, or more than 20 in a day under
  50% success). `sqid webhook enable <id>` turns it back on.
- Dedupe on the envelope `id`.
- Verify the caller. Sqid signs deliveries but the scheme is not yet documented, so
  create the endpoint with `--auth user:password` and check HTTP basic auth in the
  handler.
- Store `visitor.id` and the email; everything else can be re-read later from the
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
  if (await alreadySeen(event.id)) return Response.json({ ok: true });
  await saveVisitor({ visitorId: event.data?.visitor?.id, record: event.data });
  return Response.json({ ok: true });
}
```

Then: `sqid webhook add https://<app>/api/visitors --auth "$SQID_WEBHOOK_USER:$SQID_WEBHOOK_PASS"`
and `sqid webhook test <id>` to see the handler's answer.

## v1 identification

`--event identification-v1` sends the older, section-based payload (traits, social,
company, job, location, experience). Use it only to match an existing integration.
