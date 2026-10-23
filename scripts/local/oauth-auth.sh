#!/usr/bin/env bash
# A second Supabase Auth on the shared local stack with the OAuth 2.1 server on
# (MCPO-1, specs/mcp-oauth.md), for testing app sign-in without restarting the
# stack other sessions use. It copies the running Auth container's settings,
# adds the OAuth server, and listens on 127.0.0.1:54399 against the same
# database. Once the stack restarts with supabase/config.toml's
# [auth.oauth_server] enabled = true, the stack's own Auth does this and you
# don't need it.
#
#   scripts/local/oauth-auth.sh up     # start (or restart) it
#   scripts/local/oauth-auth.sh down   # remove it
#
# Then: MODUO_OAUTH_AUTH_URL=http://127.0.0.1:54399 bun scripts/oauth-lockout-probe.ts
set -euo pipefail

NAME=moduo_oauth_probe_auth
SOURCE=supabase_auth_moduo
PORT=54399

case "${1:-}" in
  up)
    docker inspect "$SOURCE" >/dev/null 2>&1 || { echo "The local stack's Auth ($SOURCE) isn't running: bun run local:up" >&2; exit 1; }
    image=$(docker inspect "$SOURCE" --format '{{.Config.Image}}')
    network=$(docker inspect "$SOURCE" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')
    envfile=$(mktemp)
    trap 'rm -f "$envfile"' EXIT
    chmod 600 "$envfile"
    docker inspect "$SOURCE" --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep -v -E '^(PATH|HOME)=|^$' > "$envfile"
    {
      echo "GOTRUE_OAUTH_SERVER_ENABLED=true"
      echo "GOTRUE_OAUTH_SERVER_ALLOW_DYNAMIC_REGISTRATION=true"
      echo "GOTRUE_OAUTH_SERVER_AUTHORIZATION_PATH=/oauth/consent"
    } >> "$envfile"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" --network "$network" -p "127.0.0.1:$PORT:9999" --env-file "$envfile" "$image" auth >/dev/null
    for _ in $(seq 1 15); do
      if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null; then
        echo "OAuth-enabled Auth on http://127.0.0.1:$PORT"
        exit 0
      fi
      sleep 1
    done
    echo "It didn't come up: docker logs $NAME" >&2
    exit 1
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "Removed $NAME" || echo "$NAME wasn't running"
    ;;
  *)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
