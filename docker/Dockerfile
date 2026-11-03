# syntax=docker/dockerfile:1

# Build: installs the engine and packs the plugin, then initializes a template
# engine home (the web profile with the Nova Bots plugin installed) that the
# entrypoint copies into /data on first start. Build context is the repository
# root:
#   docker build -f docker/Dockerfile -t nova-bots:local .
# node:24-bookworm-slim, pinned by digest (checked 2026-11-03). The digest is
# what the build uses; the tag behind it is only here to say what it is.
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG DSH_VERSION=0.2.0-rc.2

RUN corepack enable \
    && npm config set registry "$NPM_REGISTRY" --global \
    && COREPACK_NPM_REGISTRY="$NPM_REGISTRY" pnpm config set registry "$NPM_REGISTRY" --global \
    && npm install -g "@deepseek-ai/dsh@${DSH_VERSION}" \
        --allow-scripts=@deepseek-ai/dsh-subprocess-local,node-pty,koffi,@google/genai,protobufjs

COPY ds-bot/ /src/ds-bot/

# The plugin has no build step at install (client.js is committed), so pack it
# as-is and let the engine set up the web profile from its own template.
RUN cd /src/ds-bot \
    && npm pack --pack-destination /tmp \
    && mv /tmp/nova-bots-*.tgz /tmp/nova-bots.tgz \
    && DSH_HOME=/opt/dsh-template dsh plugin --profile web add /tmp/nova-bots.tgz

# Rebrand the compiled web shell we just installed: title, icons, manifest,
# startup log and default sidebar brand. The plugin carries the team surface.
COPY docker/nova/ /opt/nova/
RUN node /opt/nova/patch.mjs

FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash git curl ca-certificates \
        python3 python3-pip python3-venv \
        build-essential jq ripgrep unzip zip ffmpeg less procps gosu sudo \
        xvfb x11vnc fluxbox x11-xkb-utils xauth x11-utils \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
        libcups2 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
        libxkbcommon0 libasound2 libpango-1.0-0 libcairo2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

# The Bots run as the node user, so they cannot install packages on their own.
# sudo is here for the entrypoint to hand out (or withhold) that power; see
# BOT_ROOT in docker/.env.
RUN printf 'node ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/nova-bots-node \
    && chmod 0440 /etc/sudoers.d/nova-bots-node \
    && visudo -cf /etc/sudoers.d/nova-bots-node

COPY --from=build /usr/local/ /usr/local/
COPY --from=build /opt/dsh-template /opt/dsh-template
COPY --from=build /tmp/nova-bots.tgz /opt/nova-bots/nova-bots.tgz
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/docker.patch.yml /opt/nova-bots/docker.patch.yml
COPY docker/nova/migrate-plugin.mjs /opt/nova-bots/migrate-plugin.mjs
RUN ln -sf /usr/local/bin/dsh /usr/local/bin/nova

ENV DSH_HOME=/data \
    DSH_PERMISSION_MODE=danger-full-access

WORKDIR /workspace
EXPOSE 3080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

LABEL org.opencontainers.image.title="Nova Bots" \
      org.opencontainers.image.description="A team of long-lived Bots that work together" \
      org.opencontainers.image.licenses="Apache-2.0"
