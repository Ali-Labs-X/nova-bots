# The vision of Nova Bots

English | [中文](vision.zh.md)

This file says what Nova Bots is meant to be and why. For how to use it, see
the [README](../README.md); for the designs that are decided, see
[docs/plans/](plans/) (written in Chinese); for how to take part, see
[CONTRIBUTING](../CONTRIBUTING.md).

## What Nova Bots is

Nova Bots is a persistent team of bots, built on a plugin-based agent runtime.
It is open source under the Apache 2.0 license. The user can chat with one bot,
or work with a team with clear roles: one or more Main Bots organize the work,
every bot does its own part and talks to the others, and the user can see at any
time who is doing what. Bots keep working over time and have a long-term
memory.

## Two forms

| Form | What it is |
|---|---|
| The `nova-bots` plugin | A standard plugin for the desktop and web runtimes. All the bot features are here |
| The Nova Bots desktop app | Opens straight into Nova Bots itself. It brings a pinned runtime, its own profile and its own data folder, imports a team the user already has, and installs compatible plugins, so that Nova Bots grows its own plugin ecosystem. The plugin can still be used on its own |

Both forms run the same `nova-bots` plugin. The point of the app is that Nova
Bots controls its own profile and interface, free of the limits of the
runtime's general interface and global settings (see the
[runtime concessions](plans/2026-10-13-dsh-concessions.md)).

## Ten core requirements

1. **Built on the runtime, independent of each other.** Every bot is built on
   the runtime, and the bots are independent of each other.
2. **Reliable.** Bots work reliably: they stay aligned with the goal, act on
   evidence, stay inside their task, and their results can be checked. Bots
   will also be able to improve themselves (planned).
3. **Memory and persistence.** Bots keep working over time, that is, they have
   a long-term memory. A bot can read the other bots' memories but not change
   them (only a Main Bot can change another bot's memory). A bot manages its
   own memory, and the user can manage each bot's memory too. A group chat
   shares one memory.
4. **Levels of rights.** A Main Bot has the highest rights: it creates and
   changes other bots. Other bots do not have these rights, and only the user
   deletes a bot. There can be more than one Main Bot. Every bot can call on
   every other bot.
5. **Group chats.** Group chats are the core form of bots working together in
   Nova Bots. Bots in a group call on each other, and a group can have an admin
   bot. The admin manages the group, adds and removes members, and by default
   answers the user's messages.
6. **Working folders.** Each bot can have its own working folder, and a group
   chat can set one folder for all its members. A bot can set its own working
   folder, so one sentence from the user is enough.
7. **Browser.** Each bot has its own browser, and the browsers do not affect
   each other. Importing cookies is planned.
8. **Interface and motion.** Nova Bots has a polished interface with smooth
   motion: a deep-space console with an aurora palette, a living starfield and
   a glow on every surface that matters.
9. **A standalone app.** Nova Bots is meant to be a standalone app and does not
   make too many concessions to the runtime.
10. **Local agents.** Nova Bots can bring local agent CLIs in as bots that call
    on each other (planned).

## Principles for trade-offs

- **Correct bot behavior comes first.** Where a runtime mode or limit does not
  fit bots, Nova Bots does not pile up complexity to stay compatible.
  Concessions that cannot be avoided go into the
  [runtime concessions](plans/2026-10-13-dsh-concessions.md), to be removed
  once the app controls its own profile.
- **Data stays on the user's computer.** Teams, chats and memory live in Nova
  Bots' data folder on the user's computer.
- **Done means checked.** Behavior is covered by tests; interface changes are
  looked at for real.

## Who sets the direction

The maintainer decides the direction of the product, changes to decided
designs, the rules for working together, releases and the architecture. Anyone
can do the rest of the work; see
[CONTRIBUTING](../CONTRIBUTING.md#how-we-work).
