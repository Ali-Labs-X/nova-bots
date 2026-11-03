# Known issues

English | [中文](known-issues.zh.md)

## "@Name" shows as a file in a message that is not sent yet

**Where:** your own message while it waits: just after you press Send, or while it waits in the queue for a bot that is busy.

**What you see:** the runtime draws the "@" part of that message as a file reference, with a file icon. In these cases it also cuts the name:

| You type | Shown while waiting |
| --- | --- |
| `@New Bot please check` (a name with a space) | a file "New", then "Bot please check" |
| `@Anvil你看下` (no space after the name) | a file "Anvil你看下" |
| `@Anvil，帮我查` (punctuation after the name) | a file "Anvil，帮我查" |

**What is not affected:** who answers. Nova Bots reads "@Name" by its own rule, so the bot you named is called. When the message is sent, it shows the bot's mark and name as usual.

**Tip:** put a space after the name (`@Anvil 你看下`). Then a name without a space shows as the bot while it waits, too.

**Why:** the runtime draws these waiting rows itself and reads "@" up to the next space. A plugin cannot change how they are drawn yet.

## Nova Bots does not load: "disabling profile plugin row "bot""

**Where:** the web runtime (or the desktop runtime) starts, but Nova Bots is not there. The log has this line:

```text
dsh: disabling profile plugin row "bot": its declared peer dependencies cannot be validated: Cannot read properties of undefined (reading 'startsWith')
```

Installing another version of Nova Bots does not help.

**Why:** before it loads a plugin, the runtime checks each plugin row of the profile. This message means a row has the id `bot` but no package name. Nova Bots adds its own row with the name `nova-bots`, so the row without a name most likely comes from a file in the profile folder, such as an override `- id: bot` in `cordis.patch.yml` that no longer matches Nova Bots' row. We could not reproduce this, so we do not know yet how such a row is left behind.

**What to do:** the profile folder is `~/.dsh/profiles/web/` (Windows: `C:\Users\<user>\.dsh\profiles\web\`), or `profiles/web/` in the runtime's home folder (`DSH_HOME`) when it is set. For the desktop runtime, use `profiles/desktop/` instead.

1. Quit the runtime.
2. Open `cordis.patch.yml` in the profile folder. Look for a row with `id: bot` that has no `name: nova-bots` line, and remove that row. Keep a copy of the file first.
3. Check that `package.json` in the same folder lists `nova-bots` under `dependencies`. If it does not, add Nova Bots again: `npx @deepseek-ai/dsh@0.2.1-rc.4 plugin --profile web add nova-bots`.
4. Start the runtime again.

To see where the row comes from, run `npx @deepseek-ai/dsh@0.2.1-rc.4 --profile web --dump-config`. It prints every plugin row with the file that supplied it. If you report the problem, copy only the rows with `id: bot` and the file names; leave out keys and paths you do not want to share.

Deleting the whole profile folder also fixes it, but it removes the profile's other plugins and its settings, such as models. The Nova Bots team is in `~/.dsh/bot/` and is not affected either way.

## Web search fails everywhere after turning off "web-search-auto"

**Where:** every session, bot chats and normal agent chats alike, after you turn off the `web-search-auto` row in the sidebar's Plugins page or with `disabled: true` in the profile's `cordis.patch.yml`. Each `web_search` call returns:

```text
Error: configured web provider "auto" is not registered
```

The error code is `WEB_PROVIDER_CONFIGURED_MISSING`.

**Why:** Nova Bots' `cordis.patch.yml` sets the `web` row's `searchProvider` to `auto` whether or not the `web-search-auto` row is on, and the runtime does not fall back to another provider when the one it names is missing.

**What to do:** the profile folder is the same as in the entry above.

1. Quit the runtime.
2. Open `cordis.patch.yml` in the profile folder. Next to the row that turns off `web-search-auto`, add a `web` row that names another search provider. This row replaces the whole config of the `web` row, so keep `fetchProvider` in it:

   ```yaml
   - id: web-search-auto
     name: nova-bots/web-search
     disabled: true
   - id: web
     name: '@deepseek-ai/dsh-web'
     config:
       searchProvider: exa
       fetchProvider: http
   ```

3. Start the runtime again.

To check the result, run `npx @deepseek-ai/dsh@0.2.1-rc.4 --profile web --dump-config` and look at the `web` row. Another plugin can also set the search provider while the runtime runs, after the profile patch. If you turn such a plugin off later, check this setting again.

See also [Web search](../ds-bot/README.md#web-search) in the plugin README and issue #128.
