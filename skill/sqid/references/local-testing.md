# Testing locally

Sqid delivers webhooks only to public https URLs, so a handler on localhost cannot
receive real deliveries. Work in this order:

1. **Shape first.** `sqid webhook preview --event identification --json` (or `moment`)
   gives the exact payload for this site. Save it as a fixture and unit-test the handler
   against it. Nothing is sent.
2. **Snippet on a local page, on the Sandbox.** The snippet loads only on the site's exact
   origins (scheme + host + port). Allow the dev server on the Sandbox site:
   `sqid sites origins --sandbox --add http://localhost:3000` (each port is its own entry; the
   existing origins are kept). Paste `sqid snippet --site Sandbox` into the page and open it once.
   For a real site, the same command with the site's id or name instead of `--sandbox`.
3. **Real delivery.** Either deploy the handler and `sqid webhook add https://<deployed>/api/visitors`,
   or expose localhost through a tunnel the user already uses and register that https URL.
   Then `sqid webhook test <id>` sends a sample and prints the handler's response.
4. **When it fails.** `sqid webhook deliveries <id> --failed --json` has the request body
   and the response your handler returned for real deliveries (`webhook test` prints its
   answer directly and is not logged there). Fix, then `sqid webhook retry <id> <event_id>`.

## Sandbox test identities

The Sandbox identifies every new visitor as one of 50 made-up people, live, within a couple of
seconds. It never spends a credit and never produces moments (a moments walkthrough needs a real
site), and enrichment (`sqid enrich`, the identify API) is refused on it.

For a new test person: use **Forget identity** on a Test profile in the console, or run
`await squid.anonymouse()` in the page's console and reload. A private window usually lands on
the same person, because matching is by device.
