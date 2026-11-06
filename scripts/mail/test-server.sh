#!/usr/bin/env bash
# Local IMAP (Dovecot) + SMTP sink (Mailpit) for the mail integration tests
# (specs/mail-rebuild.md, Tests). Its own containers and ports: it never touches
# the shared Supabase stack.
#   scripts/mail/test-server.sh up [--messages N]   start (seeds Maildir from the fixture)
#   scripts/mail/test-server.sh down                stop and remove these containers only
#   scripts/mail/test-server.sh env                 print the MODUO_MAIL_IT_* variables
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="$ROOT/.mail-it"
IMAP_PORT="${MODUO_MAIL_IT_IMAP_PORT:-31143}"
SMTP_PORT="${MODUO_MAIL_IT_SMTP_PORT:-31025}"
UI_PORT="${MODUO_MAIL_IT_UI_PORT:-31080}"
PASSWORD="moduo-test"
DOVECOT=moduo-mail-it-dovecot
SINK=moduo-mail-it-smtp
# Built locally from Alpine's Dovecot 2.3 package so it runs natively on arm64
# (dovecot/dovecot:2.3.21 is amd64-only and crashes under Rosetta).
DOVECOT_IMAGE="moduo-mail-it-dovecot:2.3-alpine3.20"
SINK_IMAGE="axllent/mailpit:v1.21"

cmd="${1:-}"
shift || true

case "$cmd" in
  up)
    messages=2000
    if [[ "${1:-}" == "--messages" ]]; then messages="$2"; fi
    rm -rf "$DATA/maildir"
    bun "$ROOT/scripts/mail/write-fixture.ts" --format maildir --messages "$messages" --out "$DATA/maildir"
    mkdir -p "$DATA/conf"
    : > "$DATA/conf/users"
    for d in "$DATA/maildir"/*/; do
      u="$(basename "$d")"
      echo "$u:{PLAIN}$PASSWORD:1000:1000::/srv/mail/$u" >> "$DATA/conf/users"
    done
    cat > "$DATA/conf/local.conf" <<CONF
auth_mechanisms = plain login
disable_plaintext_auth = no
ssl = no
mail_location = maildir:~/Maildir
mail_uid = 1000
mail_gid = 1000
first_valid_uid = 1000
protocols = imap
listen = *
log_path = /dev/stderr
# Test data only: skip fsync, which is slow on a Docker Desktop bind mount.
mail_fsync = never
passdb {
  driver = passwd-file
  args = scheme=PLAIN username_format=%u /etc/dovecot/users
}
userdb {
  driver = passwd-file
  args = username_format=%u /etc/dovecot/users
}
namespace inbox {
  inbox = yes
  separator = /
  mailbox Sent {
    special_use = \\Sent
    auto = subscribe
  }
  mailbox Drafts {
    special_use = \\Drafts
    auto = subscribe
  }
  mailbox Archive {
    special_use = \\Archive
    auto = subscribe
  }
  mailbox Trash {
    special_use = \\Trash
    auto = subscribe
  }
  mailbox Junk {
    special_use = \\Junk
    auto = subscribe
  }
}
mail_plugins = \$mail_plugins
protocol imap {
  imap_capability = +CONDSTORE
}
CONF
    if ! docker image inspect "$DOVECOT_IMAGE" >/dev/null 2>&1; then
      printf 'FROM alpine:3.20\nRUN apk add --no-cache dovecot\nCMD ["dovecot", "-F"]\n' |
        docker build -q -t "$DOVECOT_IMAGE" - >/dev/null
    fi
    docker rm -f "$DOVECOT" "$SINK" >/dev/null 2>&1 || true
    docker run -d --name "$DOVECOT" -p "127.0.0.1:$IMAP_PORT:143" \
      -v "$DATA/conf/local.conf:/etc/dovecot/dovecot.conf:ro" \
      -v "$DATA/conf/users:/etc/dovecot/users:ro" \
      "$DOVECOT_IMAGE" >/dev/null
    # Copied in, not bind-mounted: Maildir locking on a Docker Desktop bind
    # mount makes every APPEND take ~0.3 s.
    docker exec "$DOVECOT" mkdir -p /srv/mail
    docker cp -q "$DATA/maildir/." "$DOVECOT:/srv/mail/"
    docker exec "$DOVECOT" chown -R 1000:1000 /srv/mail
    docker run -d --name "$SINK" -p "127.0.0.1:$SMTP_PORT:1025" -p "127.0.0.1:$UI_PORT:8025" \
      "$SINK_IMAGE" >/dev/null
    echo "IMAP 127.0.0.1:$IMAP_PORT  SMTP 127.0.0.1:$SMTP_PORT  sink UI http://127.0.0.1:$UI_PORT"
    "$0" env
    ;;
  down)
    docker rm -f "$DOVECOT" "$SINK" >/dev/null 2>&1 || true
    ;;
  env)
    first="$(ls "$DATA/maildir" 2>/dev/null | head -1)"
    echo "export MODUO_MAIL_IT=1"
    echo "export MODUO_MAIL_IT_HOST=127.0.0.1"
    echo "export MODUO_MAIL_IT_IMAP_PORT=$IMAP_PORT"
    echo "export MODUO_MAIL_IT_SMTP_PORT=$SMTP_PORT"
    echo "export MODUO_MAIL_IT_USER=${first:-mike@gmail.test}"
    echo "export MODUO_MAIL_IT_PASSWORD=$PASSWORD"
    ;;
  *)
    echo "usage: $0 up [--messages N] | down | env" >&2
    exit 2
    ;;
esac
