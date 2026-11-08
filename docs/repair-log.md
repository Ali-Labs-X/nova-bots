# Repair log — how the Nova Bots team fixed the Bot team

**Repository:** `Jahanzaib211/nova-bots`
**Date:** 2026-11-08
**Scope:** the "The Bot team could not start. HTTP 403." failure on `http://localhost:13080/app/`, the models page that could not set a model, and the portal that dropped its engine session.

This file is written by the bot team that did the work. It explains what broke, how it was found, what changed, and how the change was checked — with no secrets, no keys and no tokens. Anything that would expose a credential is deliberately left out.

---

## 1. Who we are

We are a team of long-lived bots that share one repository and one goal: keep Nova Bots working, one small change at a time.

| Bot | Role | What it owns |
|---|---|---|
| **Tech Lead / Architect** | admin | turns the maintainer's goals into a queue of small items, one change per branch, and reviews every result before it ships |
| **Full-Stack Developer (Core)** | builder | writes the fix on its own branch, in its own git worktree, following the code around it |
| **QA / Quality Engineer** | checker | runs the gates — tests, build check, lint, leak scan, smoke — and reports totals, not adjectives |
| **Release & GitHub Manager** ("Gatekeeper") | shipper | the only bot that pushes, opens pull requests and reads CI; merges only with the maintainer's OK |
| **Security Reviewer** | reviewer | reviews every change before it ships; measures attack rows instead of reasoning about them |
| **Researcher** | fact-finder | supplies facts with a source and a version, never a guess |
| **Docs Writer** | documenter | owns the READMEs and `docs/`, and keeps the English and Chinese versions in step |
| **DevOps / SRE** | operator | keeps the container, the tunnel, the units and CI healthy, and reports from measurement |
| **Local Model Tester** | lab | exercises the runtime against real local model endpoints |

The rules we work by, in one place:

1. **Evidence, not claims.** Every "done" comes with the command that was run and its output.
2. **One change in flight at a time**, one branch per change, one worktree per bot.
3. **Build on the runtime; never patch it.** If the runtime lacks something, we stop and say so.
4. **No secrets anywhere.** Keys are never printed, logged, written or committed.
5. **Only the shipper pushes.** Nobody force-pushes, rebases a pushed branch, disables a check, edits `CHANGELOG.md`, or merges without the maintainer's OK.

---

## 2. The failure we were sent to fix

The browser showed:

> **The Bot team could not start. HTTP 403.**

The app is served by the portal on `http://localhost:13080/app/`. Every roster poll and every live socket was refused with **403 forbidden**, so the Bot team never started.

### Finding the cause

The runtime's browser-trust fence (`dsh-client-connection`, `isTrustedApiRequest`) compares the **Origin authority** with the **Host authority** and refuses the request when the two differ.

In front of the portal sits the nginx front door, and it forwards the host **without its port**:

```nginx
proxy_set_header Host $host;   # http://localhost:13080  ->  Host: localhost
```

The browser's `Origin` still carried the port (`http://localhost:13080`). So the engine saw

```
Host:   localhost
Origin: http://localhost:13080
```

— two different authorities — and refused. On the public site (`https://bots.alilabsx.com`) no port appears in either header, which is exactly why the public site was never affected.

Measured against the live engine, before the fix:

| request | Host sent to the engine | Origin | result |
|---|---|---|---|
| the browser on the local app | `localhost` | `http://localhost:13080` | **403 forbidden** |
| the browser on the public site | `bots.alilabsx.com` | `https://bots.alilabsx.com` | 200 |

### The first attempt, and why it was rejected

The obvious fix is to take the authority from the `Origin`. **Security Reviewer blocked it**, and the reason is worth writing down.

The browser's same-site rules ignore ports. A page on `http://localhost:3000` is *same-site* with `http://localhost:13080`, so it carries the portal's `SameSite=Lax` cookie — and it gets to name its own authority in the `Origin`. Handing the engine whatever the `Origin` says would let a page on another port of the same host impersonate the portal.

### The rule we shipped

The authority the engine sees is **the host as it came, with the front door's own port restored from configuration** — the port is never taken from the request.

- `NOVA_PORT` (operator configuration, in `portal/portal.env`) names our own port.
- The `Origin` is believed **only** when it names exactly that dialled authority. Otherwise the host as it came stands.
- The mint of the engine cookie and the upstream request use **one** authority, because the engine's cookie is bound to that authority.

So the set of authorities that can reach the engine is `{host as it came} ∪ {host:NOVA_PORT}` — bounded by our own configuration, never by the caller.

Where it lives: `portal/bridge.mjs`, with the rules spelled out in `portal/test/bridge.test.mjs` (16 cases).

### How it was checked

Not by reading the diff. The rules were fed through the **real** fence of the packaged runtime, and the hostile rows were measured:

| scenario | result |
|---|---|
| the legitimate browser on the local app | **200** (fixed) |
| a hostile page on the same host, another port | **403** (stays refused) |
| the public site, legitimate browser | **200** (no regression) |
| the public host, another port | **403** |
| a foreign host, a subdomain, a forged `Host`+`Origin`, a userinfo URL, `Origin: null` | **403** |

The same behaviour was then confirmed on the running system, through the front door and directly against the portal, and the live socket upgrade was checked to return **101 Switching Protocols**.

Local gates on the change: `npm ci` exit 0 · the portal suite **54 tests, 54 pass, 0 fail** · leak scan **641 files scanned, 0 must-fix** · no allowlist, no scanner rule touched.

Pull request: **#28** — `fix(portal): give the engine the authority the browser used`.

---

## 3. The other two fixes from the same day

### The models page could not set a model (#24)

`fix(ds-bot): give Nova Bots its own models page and name a refused roster`

The plugin used a shared page that could not represent the model list Nova Bots actually offers. It now has its own page, and a model that is refused is named rather than silently missing — so the page tells you *why* a model is not in the list instead of showing an empty row.

### The portal dropped the engine session (#25)

`fix(portal): keep the portal's engine session alive across a token or key change`

When the launch token or a key changed, the portal's session to the engine was invalidated and the team had to start again. The session now survives that change.

### The smaller ones

| PR | Change |
|---|---|
| #19 | ignore a `node_modules` symlink as well as a directory |
| #20 | serve the app's own UI from the Host at the Host's origin |
| #21 | one home screenshot in the README, the eight old screenshots removed |
| #22 | state the 300-character entry limit in the `remember` tool |
| #23 | clamp `script-src-elem` and `script-src-attr` |
| #26 | let the test bench find the runtime and read its banner |
| #27 | keep an embedding model out of the chat model lists |
| #30 | carries #21 and #23 into `dev`: the README screenshot and the CSP clamp, with the product links restored |

---

## 4. What was deliberately not done

- **No patch inside the runtime.** Every change is in this repository, built on the documented plugin APIs.
- **No secret was ever printed.** The launch token and the session secret stay on disk; the token is read from its file at run time and never displayed.
- **No weakening of the security fence.** The hostile same-host, other-port case stayed at 403 through every revision, and it was the reason the first version of the fix was rejected.
- **No merge without the maintainer.** Eleven pull requests (#19–#30) went out open and green, and the seven that are in `dev` were merged only after the maintainer said so.
- **No blind find-and-replace.** Renames were done one checked file at a time.

---

## 5. How a change travels through the team

```
maintainer's goal
      │
      ▼
Tech Lead  ── plan, split into one item per branch, assign
      │
      ▼
Full-Stack Developer ── build in its own worktree, on its own branch
      │
      ▼
QA ── npm test, build check, lint, leak scan, smoke  ── totals, not adjectives
      │
      ▼
Security Reviewer ── measure the attack rows, approve or block
      │
      ▼
Tech Lead ── read the diff, check it against AGENTS.md
      │
      ▼
Gatekeeper ── push, open the pull request, watch CI  ── merge only on the maintainer's OK
```

A change is one branch and one pull request. The reviewer that blocks the first version is not a failure of the process — it is the process working.

---

## 6. The three fixes, in one table

| what | where it lives | state |
|---|---|---|
| the 403 fix | `portal/bridge.mjs` | live and confirmed on the running system (PR #28) |
| the portal session fix | `portal/server.mjs` + `portal/bridge.mjs` | live and confirmed (PR #25) |
| the models page | the installed client bundle, served from the data volume | live and confirmed (PR #24) |
| the code itself | branches and pull requests #19–#30 on GitHub | #19, #20, #22, #24, #25, #26 and #27 merged into `dev` on the maintainer's OK; #21 and #23 travel in #30, which is open; #28 is open |

---

*Written by the Nova Bots bot team. No secrets, keys or tokens appear in this file.*
