# Pinned resources

Everything the deployment needs at build time is pinned, so a rebuild months
later produces the same thing and never fails because a tag moved.

| What | Pinned to | Refresh |
|---|---|---|
| Base image (both stages) | `node:24-bookworm-slim@sha256:c86ecead…` | `docker buildx imagetools inspect node:24-bookworm-slim --format '{{json .Manifest.Digest}}'` |
| Web front end | `nginx:1.29-alpine@sha256:5616878…` | `docker buildx imagetools inspect nginx:1.29-alpine --format '{{json .Manifest.Digest}}'` |
| Agent runtime | `NOVA_ENGINE_VERSION=0.2.0-rc.2` (exact) | `docker/.env` |
| Plugin build tools | `ds-bot/package.json` (`esbuild`, `@xmldom/xmldomain`) — exact versions | `npm install --save-exact` |
| Test packages | `ds-bot/dev/harness/package.json` — exact versions | `npm install --save-exact --prefix dev/harness` |
| Portal packages | `portal/package.json` + `portal/package-lock.json` — exact versions | `npm install --save-exact` in `portal/` |
| System packages | the Debian packages of the pinned base image | rebuild the image |

## No network at runtime

- The plugin's update check is off (`updateCheck: false` in
  `docker/docker.patch.yml`): the image is updated by rebuilding it, so the
  plugin never asks a registry or a repository for a newer release.
- The portal talks to the engine and to the local Postgres server only.
- The Cloudflare connector reads its token from a file on this machine.
- The only outbound call the bots can make is the web search they are asked to
  do; when it fails, the bot is told the search is unavailable rather than
  guessing.

## Installing the portal on a fresh machine

```sh
cd ~/Desktop/Nova-Bots/portal
npm ci --omit=dev        # exact versions from package-lock.json
```

`npm ci` never resolves a range, so it installs the pinned versions and fails
loudly if the lock file and `package.json` disagree.
