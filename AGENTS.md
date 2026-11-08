# AGENTS.md

Instructions for AI coding agents that work on this repository. Human
contributors: see [CONTRIBUTING.md](CONTRIBUTING.md), which has the same rules
with more detail.

## Agent coordination

- Delegate only the work that is actually needed and keep updates concise to avoid wasting tokens.
- When coordinating multiple agents, check every agent's status before reporting completion.

## What this project is

Nova Bots is a team of long-lived bots built on a plugin-based agent runtime. It
has two parts:

- `ds-bot/`: the bot features, written as a plugin. The plugin runs in the
  desktop runtime, the web runtime and the container.
- `app/`: the desktop app for Windows, macOS and Linux. It runs a pinned
  runtime with the `nova-bots` plugin, in its own profile and its own home, and
  imports an existing team from the user's runtime.

The bot team:

- Every bot is a long-lived identity whose work runs in runtime sessions: one
  for its own chat, one for each group it is in, and a fresh one when the
  context fills up (earlier ones stay readable). Every turn runs through the
  normal agent loop, tools and model routes.
- The team works together: bots message each other, share group chats and can
  see what the other bots are doing. Each bot still runs on its own and does not
  disturb the others.
- Bots have clear, different roles. A Main Bot has the highest rights: it
  creates, changes and removes other bots. Other bots do not get these rights.
  There can be more than one Main Bot.
- Users customize each bot (name, role label, instructions, model, character).
- Behavior must be reliable: a bot acts on evidence, stays inside its goal, and
  its results can be checked.

## Hard rules

1. **Build on the runtime; never patch it.** Bot features use the documented
   plugin APIs. The desktop app starts the runtime only through its documented
   entry points. Never patch the agent runtime or depend on files inside an
   install. If something is missing in the runtime, stop and say so; do not work
   around it with a patch.
2. **No secrets.** Never write, print or commit API keys, tokens, cookies or
   runtime home contents. Use the mock model (`ds-bot/dev/mock-llm.mjs`) for
   tests; it needs no key.
3. **Only original material.** Do not copy code, text, icons, logos or graphics
   from other products or websites. Code under a license compatible with
   Apache 2.0 is the only exception: say where it comes from and add its notice
   to the `NOTICE` file.
4. **`client.js` is generated.** Change `ds-bot/src/client/`, then run
   `npm run build` and commit both files. Never edit `client.js` by hand.
5. **Do not touch the user's own runtime data.** The desktop app keeps its data
   in its own home; its import only reads the user's runtime home and never
   writes there. The test bench keeps its data in an ignored test folder. Never
   point a test at a user's home, at the desktop app's data or at a runtime that
   the user runs.

## Commands

Run in `ds-bot/`. The unit tests and the linter load the runtime packages from
`dev/harness/`, which `npm run harness` installs from npm at the version in
`dev/harness/package.json`. The harness resolver can point them at another
install or at a runtime checkout instead.

```sh
npm ci                                 # build tool only (esbuild)
npm run harness                        # once: the runtime packages for the tests and the linter
npm run build                          # src/client → client.js
npm test                               # unit tests; also fail if client.js is stale
node scripts/build-client.mjs --check  # client.js matches src/client
npm run lint                           # oxlint
CONTEXT_WINDOW=100000 CHECK_RATIO=0.45 dev/bench.sh smoke 3096 8796 reset && node dev/smoke.mjs smoke 3096   # smoke test
dev/bench.sh smoke 3096 8796 stop
```

A change is done when `npm test`, the `--check` and `npm run lint` pass; CI runs
them on every pull request. Run the smoke test as well for changes to `index.js`
or `src/host/`. Use a free port for each bench, and stop every bench and process
that you started.

## Branches, pull requests and issues

The full workflow is in [CONTRIBUTING.md](CONTRIBUTING.md#how-we-work). The parts
that an agent must follow:

- Start work from the latest `dev` on a branch named `fix/<issue>-<name>`,
  `feat/<issue>-<name>`, `docs/<name>` or `chore/<name>`. Never start a branch
  name with `dev/`. Open the pull request into `dev`, not `main`; only releases
  and hotfixes go into `main`.
- Bring a branch up to date with `git merge dev`. Never rebase a pushed branch
  and never force-push.
- Fill in the pull request template. Link the issue with `Fixes #<number>`; a bug
  fix names the bug it fixes. Write the user-visible change in the Changelog
  field, and do not edit `CHANGELOG.md`.
- Do not start work on an issue or pull request with the `maintainer` label; it
  waits for the maintainer. Do not take an issue that someone else is assigned
  to.
- Before you change behavior, read the design for it in `docs/plans/` (and
  `docs/vision.md`); for interface work also `docs/design/ui-standard.md`. A
  change to a decided design needs the maintainer; a new large feature adds its
  design note to the same pull request.
- Do not close an issue without evidence: the pull request or commit that fixed
  it, the issue it duplicates, or the reason it will not be fixed.
- To triage issues, follow [.agents/skills/issue-triage/SKILL.md](.agents/skills/issue-triage/SKILL.md).
- To record a demonstration GIF for an interface change, follow
  [.agents/skills/record-browser-gif/SKILL.md](.agents/skills/record-browser-gif/SKILL.md).

## Layout

- `ds-bot/index.js` and `ds-bot/src/host/`: the server side (roster and store,
  tools, turns and delivery, groups, conversation parts and the search index,
  images, the browser bridge, the `api/bot` channel).
- `ds-bot/src/client/`: the browser side (sidebar, chat, panels, themes,
  characters, the bot browser panel).
- `ds-bot/web-search.js`: the `auto` web-search provider, independent of the bot
  team code.
- `ds-bot/test/`: unit tests and fixtures. `ds-bot/dev/`: the runtime packages
  for the tests (`harness/`), mock model, test bench, smoke test, character
  generator, desktop scripts for Linux.
- `app/`: the desktop app (Electron main process and window, first-run setup and
  import, installer and updates).

## Style

- Follow the code around your change. Keep functions small and names plain.
- Write a comment only when the reason is not clear from the code: a hidden
  constraint, an invariant, a workaround. Do not describe what the code does.
- Commit messages in English, imperative subject, the reason in the body. Keep
  commits small.
- The person who asked for the change is the commit author. Do not set an AI
  agent or bot as author or committer, and do not add `Co-authored-by` lines for
  one.
- User-facing text in the plugin is English. Keep the README and README.zh.md in
  step when you change one of them.
