# Browser side: react to identification on the page

No webhook needed. After the snippet is in the layout, `window.squid` is available.
The engine replays the stored result if the visitor was identified before you listened,
so timing does not matter.

```js
const engine = new squid.engine();
engine.on("visitor.identified", (e) => {
  const v = e.detail;            // email, name, company, title, linkedin_url, ...
  greet(v.firstName, v.company);
});
engine.on("visitor.unknown", () => { /* anonymous: default UI */ });
engine.on("visitor.synced", (e) => { /* every visitor, identified or not */ });
```

- `engine.visitor()` returns `{ meta, traits, identified }` at any time, no event needed;
  `meta.sandbox` is true on a Sandbox site. `traits` is null until the first sync.
- Moments in the browser (Signals must be on; Sandbox sites get none):
  `engine.on("visitor.moment", (e) => { if (e.detail.decision.action === "engage") openChat(e.detail.decision.instruction); })`.
  `visitor.moment` only fires live; the three visitor events replay to late listeners.
- The event is `visitor.synced`. The older spelling `visitor.synched` no longer fires.

- Route the profile through your own backend first with `new squid.engine({ sp: "https://api.yourapp.com" })`;
  Sqid POSTs to `{sp}/visitor_details` and gives the browser your response.
  https://docs.sqid.dev/sdk/service-provider.md
- After login or a form: `await squid.identify({ email })`. Sqid enriches on the next
  connection and fires `visitor.identified`. https://docs.sqid.dev/sdk/identify.md
- Label clicks you want in click webhooks: https://docs.sqid.dev/sdk/label-clicks.md
- Event payloads: https://docs.sqid.dev/sdk/events.md

Never put account or SDK keys in browser code. The snippet's site id is the only
identifier the page needs.
