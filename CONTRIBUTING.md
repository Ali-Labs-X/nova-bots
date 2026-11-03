# Contributing to Nova Bots

English | [中文](CONTRIBUTING.zh.md)

Thank you for helping. This file explains how the team works, how to set up the
plugin, how to test a change and which rules a change must follow. For what the
plugin does and how users install it, see [README.md](README.md).

## The rules that matter most

1. **Build on the runtime; never patch it.** The bot features are a plugin: use
   the documented plugin APIs (services, the plugin client entry, profile
   patches). Do not patch the agent runtime and do not depend on files inside
   its install. When a feature needs something the runtime does not offer, open
   an issue here first; the fix can belong upstream.
2. **Bots run in runtime sessions.** A bot keeps its identity while its work
   runs in sessions: one for its own chat, one for each group, a fresh one when
   the context fills up. Every turn goes through the normal agent loop, tools
   and model routes. Do not add a second agent runtime.
3. **No real secrets anywhere.** Do not commit API keys, tokens, cookies, home
   folders, logs or screenshots with personal data. The tests and the test bench
   use a scripted mock model and need no key.
4. **Only original material.** Do not copy code, text, icons, logos or other
   graphics from other products or websites. Code under a license compatible
   with Apache 2.0 is the only exception: say where it comes from and add its
   notice to the `NOTICE` file.
5. **Every change is tested.** Run the unit tests and the client check for every
   change (see [Test a change](#test-a-change)).

## How we work

Anyone on the team can do any kind of work: triage, bug fixes, features, the
interface, docs. Only some decisions belong to the maintainer: the direction of
the product, changes to a design that is already decided, these rules, releases
and the architecture. Issues and pull requests that need such a decision carry
the `maintainer` label; wait for the maintainer's answer before you start.

What Nova Bots is meant to be is in [docs/vision.md](docs/vision.md); decided
designs are in [docs/plans/](docs/plans/), and the interface standard is in
[docs/design/ui-standard.md](docs/design/ui-standard.md). When you are not sure
whether something is a bug or works as designed, read them first, then ask in
the issue.

### Branches

| Branch | What it is | Who merges |
|---|---|---|
| `dev` | Integration branch. All fixes and features go here first | Every collaborator, when CI passes |
| `main` | Released code only. It changes when the maintainer merges `dev` for a release, or merges a hotfix | The maintainer |
| `fix/<issue>-<name>`, `feat/<issue>-<name>`, `docs/<name>`, `chore/<name>` | Your work. Start it from the latest `dev` | — |

- Do not start a branch name with `dev/`. Git cannot create `dev/<name>` while
  the branch `dev` exists.
- To bring your branch up to date, run `git merge dev` (on a hotfix branch,
  `git merge main`). Do not rebase a pushed branch and do not force-push.
- Open pull requests into `dev`, not `main`; only releases and hotfixes go into
  `main`.

### Issues

1. **Triage.** Give each new issue a type, a priority and an area (see
   [Labels](#labels)). One priority label per issue.
   - A question (how to install, how to use): convert it to a discussion.
   - Not enough information to find the cause: add `needs-info` and ask for
     exactly what is missing. Say that the issue is closed after 14 days
     without an answer.
   - A cause in the runtime or another plugin: add `upstream` and link the
     place where it belongs.
   - The same as an open issue: add `duplicate`, link the other issue and close
     this one.
2. **Claim.** Assign the issue to yourself and write "I'll take this" in it
   before you start, so two people do not work on the same thing. Do not take
   an issue that already has an assignee; ask in the issue first.
3. **Features.** A new idea starts in Discussions (Ideas). When the maintainer
   agrees, it becomes an issue with the `enhancement` label. Before you build a
   feature, write in the issue how you plan to do it. For a large feature, add a
   design note in `docs/plans/<date>-<topic>.md` to the same pull request.
4. **Close with evidence.** When you close an issue, link the pull request or
   commit that fixed it, the issue it duplicates, or the reason it will not be
   fixed. Write the comment in the language of the issue.

### Labels

| Kind | Labels |
|---|---|
| Type | `bug` · `enhancement` · `documentation` |
| Priority | `P0` crash, data loss or cannot use · `P1` hurts daily use · `P2` ordinary bug or feature · `P3` suggestion or narrow case |
| Area | `area/host` server side (`index.js`, `src/host/`) · `area/client` interface (`src/client/`) · `area/group` group chats, mentions, bot-to-bot messages · `area/memory` memory, conversation parts, context · `area/browser` bot browser, page reading, web search · `area/build` CI, release, scripts, test bench · `area/docs` |
| Flow | `maintainer` waits for the maintainer · `needs-info` waits for the reporter · `upstream` the cause is in the runtime or another plugin · `duplicate` · `auto-found` found by automated testing |

An issue that spans several areas, or none, gets no area label.

### Pull requests

1. Open the pull request into `dev` and fill in the template. Link the issue
   with `Fixes #<number>`; a bug fix always names the bug it fixes.
2. Write one sentence about what users will notice in the **Changelog** field
   of the template, or "none". Do not edit `CHANGELOG.md`: the maintainer
   writes it from these sentences at release time.
3. When CI passes, merge it yourself with **Create a merge commit**, then
   delete the branch. A review is not required; if you want one, ask a teammate
   in the pull request.
4. A fix merged into `dev` does not close its issue: `Fixes #<number>` acts only
   on the default branch. The issue stays open until the release, which means
   "fixed in `dev`, not released yet".

Keep one pull request to one issue. Split a large change into several pull
requests.

### Merge conflicts

- **`ds-bot/client.js`**: never resolve it by hand. Resolve the conflicts in
  `ds-bot/src/client/`, run `npm run build` in `ds-bot/` and commit the new
  `client.js`.
- **`CHANGELOG.md`**: pull requests do not change it, so it should not
  conflict. If it does, keep both sides.

### Releases (maintainer)

1. In a pull request into `dev`, set the version in `ds-bot/package.json` and
   write the `CHANGELOG.md` section from the Changelog sentences of the merged
   pull requests.
2. Open a pull request from `dev` into `main` titled `release: vX.Y.Z`. List
   every `Fixes #<number>` of the release in its description, so these issues
   close when it is merged.
3. Before you merge it, run the [release checklist](docs/dev/release-checklist.md)
   on a real machine and post the result in the pull request. Merge it with a
   merge commit, tag it `vX.Y.Z` and publish the release.
4. For a hotfix, start `fix/hot-<name>` from `main`, open the pull request into
   `main`, release a patch version, then merge `main` into `dev`.

## Set up

You need:

- Node.js `22.19` or later.
- Git.
- For the test bench only: pnpm `11` and a checkout of the agent runtime at the
  version this plugin is tested with.

```sh
git clone <your-nova-bots-repository> Nova-Bots
cd Nova-Bots/ds-bot

# The plugin's own build tool (esbuild only).
npm ci

# The runtime packages that the unit tests and the linter load, from npm.
npm run harness
```

The runtime packages are peer dependencies: in a real install, the profile
supplies them. `ds-bot/.npmrc` keeps npm from installing them into the plugin
folder.

## Layout

| Path | What it is |
|---|---|
| `ds-bot/index.js`, `ds-bot/src/host/` | The server side: bot roster and store, tools, turns and delivery, group chats, conversation parts and the search index, images, the bot browser bridge, the `api/bot` channel |
| `ds-bot/src/client/` | The browser side: sidebar, chat, panels and dialogs, themes, characters, the bot browser panel |
| `ds-bot/client.js` | Generated from `src/client/` by `scripts/build-client.mjs`. It is committed, so Git installs need no build step |
| `ds-bot/web-search.js` | The `auto` web-search provider. It does not depend on the bot team code |
| `ds-bot/cordis.patch.yml` | The profile patch the plugin brings |
| `ds-bot/test/` | Unit tests and fixtures |
| `ds-bot/dev/` | Runtime packages for the unit tests (`harness/`), the mock model, the test bench, the smoke test, the character generator, the desktop scripts for Linux, and two tools for real models: the steward evaluation and a logging pass-through |

## Test a change

Run these in `ds-bot/`:

```sh
npm run build                          # src/client → client.js
npm test                               # unit tests; they also fail if client.js is stale
node scripts/build-client.mjs --check  # client.js matches src/client
npm run lint                           # oxlint
```

CI runs the same three checks on every pull request, on Linux and Windows. It
also scans the tracked files for keys, tokens, personal paths and e-mail
addresses, and for material that must stay local.

For a change to the server side (`index.js`, `src/host/`), also run the smoke
test. It starts the mock model and a web runtime with the plugin linked from
your checkout, and walks through the main flows (bots, group chats, conversation
parts, condensing, settings). `CONTEXT_WINDOW` and `CHECK_RATIO` give the mock
models a small window, so a few long replies reach the check line:

```sh
CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh smoke 3096 8796 reset && node dev/smoke.mjs smoke 3096
dev/bench.sh smoke 3096 8796 stop
```

To try the plugin by hand, start a bench and open the address it prints:

```sh
dev/bench.sh dev 3081 8771 reset    # mock model + web runtime; data in ../.dsh-test-dev
```

The mock model answers a fixed set of commands, so a bench costs no tokens. The
commands are listed at the top of `dev/mock-llm.mjs`. Bench data stays in
`.dsh-test-<name>/` next to the plugin folder and never touches your own data.

For a change to the context steward or its prompts (`src/host/steward.js`), also
check it on a real model. `dev/steward-eval.mjs` runs its decisions on fixed
conversation endings, and `dev/llm-tap.mjs` logs every call a real bench makes.
Both cost tokens and explain their use at the top.

For a change to the bot browser, check it in the desktop runtime. On Linux, the
scripts in `dev/desktop-linux/` run that runtime under Xvfb; each script explains
its use at the top.

## Write a change

- Keep a change to one subject.
- Do not edit `client.js` by hand. Change `src/client/`, run `npm run build` and
  commit both.
- In `src/client/`, take colors from the `--bt-*` variables, corner radii from
  the steps 4, 6, 8, 10, 12, 16, 18, 20, 22, 999px and 50%, and springs from
  `motion.js`. A unit test checks this. The places written before the test are
  listed in `test/style-debt.json`; that list only gets shorter. When you remove
  one, run `node scripts/style-debt.mjs --write` to update it.
- Follow the style of the code around your change. Write a comment only when
  the reason for the code is not clear from the code itself.
- Write commit messages in English. Use a short subject in the imperative mood
  ("Keep group replies visible") and explain the reason in the body.
- The author of a commit is the person who made the change. When an AI tool
  helped, do not add it as an author or with a `Co-authored-by` line.
- Do not edit [CHANGELOG.md](CHANGELOG.md). Write the user-visible change in the
  Changelog field of the pull request instead.

## Report a problem

The easiest way is from Nova Bots itself: open **Settings → Feedback**, write
what happened and select **Report on GitHub** when an issue tracker is
configured. It opens a new issue with the Nova Bots version, your system, the
models and the recent errors already filled in. **Copy** puts the same text on
the clipboard, and **Download** saves the full error log
(`<home>/bot/logs/diagnostics.jsonl`).

If you open an issue by hand, include:

- The Nova Bots version and how you installed it.
- Your operating system and how you run the app (Docker or a plugin install).
- What you did, what you expected and what happened, with the exact error text.
- A screenshot of the whole window, with the chat and the error.
- The steps that make it happen again.

Nova Bots removes API keys, tokens, saved secrets and your home folder from its
diagnostics. Read the text before you post it, and remove personal data from
screenshots.

For a security problem, do not open a public issue. Use **Report a
vulnerability** on the repository's **Security** tab.

Issues are for bug reports. Questions, ideas and feature requests belong in
Discussions. An idea that the maintainer accepts becomes an issue.

## License

Nova Bots is licensed under the [Apache License 2.0](LICENSE). When you submit a
contribution, you agree that it is licensed under the same license, as section 5
of the license says.
