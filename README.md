# sqid

Sqid from the terminal and from coding agents. Sign in with your browser, create a
site, receive visitor identifications and moments, manage billing. Nothing secret
passes through the terminal: sign-in and card entry happen in the browser.

```
npx sqid login          # browser sign-in (Clerk OAuth, PKCE, loopback callback)
npx sqid login --device # SSH or containers: URL + code
npx sqid whoami
npx sqid logout --yes
```

Agent mode (JSON in and out, `next` on every result, errors with `code`, `remedy`,
`examples`) is on whenever stdout is not a terminal, or with `--json` / `SQID_MODE=agent`.
Credentials live in `~/.config/sqid/credentials.json` (0600); `SQID_TOKEN` overrides.

Design: `platform2/sqid/CLI.md`. Docs: https://docs.sqid.dev
