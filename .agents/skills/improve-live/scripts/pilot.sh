#!/usr/bin/env bash
# A throwaway engine with the mock model, from the image that runs live.
#   pilot.sh up [docker.patch.yml]   start it on 127.0.0.1:15480 and print its login address
#   pilot.sh client                  serve this checkout's ds-bot/client.js in it
#   pilot.sh down                    remove it and its data
# It has volumes of its own and never reads the live team or its settings.
set -eu
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
name="${NOVA_PILOT_NAME:-nbt-pilot}"
port="${NOVA_PILOT_PORT:-15480}"
image="${NOVA_PILOT_IMAGE:-nova-bots:local}"

mock() {
  docker rm -f "$name-mock" >/dev/null 2>&1 || true
  docker run -d --name "$name-mock" --network "container:$name" -v "$root/ds-bot/dev:/mock:ro" \
    -e MOCK_PORT=8796 -e MOCK_LOG=/tmp/mock.jsonl -e MOCK_DELAY_MS=200 --entrypoint node "$image" /mock/mock-llm.mjs >/dev/null
}
ready() {
  for _ in $(seq 90); do
    case "$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$port/" || true)" in 200|401) return 0 ;; esac
    sleep 1
  done
  echo "the pilot engine did not answer" >&2
  return 1
}

case "${1:-}" in
  up)
    docker rm -f "$name-mock" "$name" >/dev/null 2>&1 || true
    patch=()
    [ -z "${2:-}" ] || patch=(-v "$(realpath "$2"):/opt/nova-bots/docker.patch.yml:ro")
    docker run -d --name "$name" --cpus 4 --memory 4g -p "127.0.0.1:$port:3080" \
      -v "$name-data:/data" -v "$name-work:/workspace" ${patch[@]+"${patch[@]}"} \
      -e NOVA_LAUNCH_TOKEN_FILE=/data/.launch-token -e NOVA_TRUSTED_HOST=localhost,127.0.0.1 -e DSH_TELEMETRY_DISABLED=1 \
      -e DEEPSEEK_BASE_URL=http://127.0.0.1:8796/v1 -e DEEPSEEK_API_KEY=mock-key "$image" >/dev/null
    mock
    ready
    echo "http://127.0.0.1:$port/?token=$(docker exec -u node "$name" cat /data/.launch-token)"
    ;;
  client)
    docker cp "$root/ds-bot/client.js" "$name:/data/profiles/web/node_modules/nova-bots/client.js" >/dev/null
    docker restart -t 5 "$name" >/dev/null
    mock
    ready
    ;;
  down)
    docker rm -f "$name-mock" "$name" >/dev/null 2>&1 || true
    docker volume rm -f "$name-data" "$name-work" >/dev/null 2>&1 || true
    ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac
