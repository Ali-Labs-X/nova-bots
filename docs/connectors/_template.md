# <Service name>

<!--
One page per service. It answers: how do I actually run this one?
It does not repeat the catalogue table (price, licence, free tier) — that is docs/connectors.md.
Delete the comments in the finished page.
-->

- Catalogue row: [`docs/connectors.md`](../connectors.md)
- Registry id: `<id>`
- Credential: `none` · `token` · `OAuth app` · `account` — secret name: `<SECRET_NAME>`
- Licence: `<licence>`
- Version / date read: `<version>`, read `<YYYY-MM-DD>`

## What it does

One or two sentences, in the same voice as the catalogue row. No adjectives.

## Runs as

- `built-in skill` · `local process (stdio)` · `remote endpoint (streamable-http)`
- Measured or expected: `<measured | expected>` — `<what was measured, and where>`

## Install

The exact steps, copy-pasteable. For a remote endpoint: where the user gets the credential, and
what the vendor's own page says. The "paste your token" link must stay on the vendor's own
domain.

```
<commands>
```

## Tools exposed

- `mcp__<id>__<tool>` — `<what it does>`
- …

## Credential handling

- The credential lives in the team secret store under `<SECRET_NAME>` and is used in exactly one
  place: the request headers of this connector's own endpoint, built in memory at mount time.
- It never reaches the Nova profile, never reaches any Bot's shell, never appears in a tool
  result or a model request, and never reaches another connector's endpoint.
- The connector is granted per Bot. A Bot without the grant does not see these tools.
- If a credential is sent to any host other than this service's own, the request is blocked.

## Flags

- `needs a card` · licence trap · name trap · anything else a reader must know before connecting.

## Verified

- Row last checked: `<YYYY-MM-DD>`. Re-check when the version, the price or the licence moves.
