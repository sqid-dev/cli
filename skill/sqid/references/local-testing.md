# Testing locally

Sqid delivers webhooks only to public https URLs, so a handler on localhost cannot
receive real deliveries. Work in this order:

1. **Shape first.** `sqid webhook preview --event identification --json` (or `moment`)
   gives the exact payload for this site. Save it as a fixture and unit-test the handler
   against it. Nothing is sent.
2. **Snippet on a local page.** The snippet works on `http://localhost:*` for a site whose
   origins include it; otherwise add the local origin to the site in the console. Open the
   page once; `sqid doctor` then shows `deployed`.
3. **Real delivery.** Either deploy the handler and `sqid webhook add https://<deployed>/api/visitors`,
   or expose localhost through a tunnel the user already uses and register that https URL.
   Then `sqid webhook test <id>` sends a sample and prints the handler's response.
4. **When it fails.** `sqid webhook deliveries <id> --failed --json` has the request body
   and the response your handler returned. Fix, then `sqid webhook retry <id> <event_id>`.

Identified test visitors (Stripe-style fixtures you can trigger on demand) are planned
for the Sandbox site; until then real identifications come from real visitors.
