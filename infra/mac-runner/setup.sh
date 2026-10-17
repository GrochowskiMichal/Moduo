#!/bin/bash
# Mike's Mac as the `moduo-mac` GitHub Actions runner for desktop builds (spec platform-v2, PLAT-7).
#
#   sudo infra/mac-runner/setup.sh            set up or repair; safe to run again
#   sudo infra/mac-runner/setup.sh --verify   check isolation, keychain, toolchain and service
#   sudo infra/mac-runner/setup.sh --stop     stop the runner (jobs go to GitHub-hosted macOS)
#   sudo infra/mac-runner/setup.sh --start    start it again
#
# Run it yourself in a terminal: it asks for your password (sudo), the .p12 password, and the
# notarization login. Before the first run, do the steps in infra/mac-runner/README.md.
#
# What it sets up:
#   - a standard (non-admin), hidden macOS user `moduo-ci` with its own group, so it is not in
#     `staff` and can't read your home (macOS homes are 750, group staff)
#   - in that user's home: rustup with the pinned nightly and both Apple targets, Bun from
#     .bun-version, a persistent Cargo target dir and Bun cache under ~moduo-ci/cache
#   - a keychain of its own holding only the Developer ID Application identity and the
#     notarization login (a notarytool profile); its password sits in a 600 file only moduo-ci reads
#   - the GitHub Actions runner, registered to the repo as `moduo-mac` (labels self-hosted, macOS,
#     ARM64, moduo-mac), as a LaunchDaemon that runs as moduo-ci, starts at boot and needs no login
#   - a job-started hook (job-started.sh) that refuses every job except pushes to develop/mike,
#     v* tags and the owner's manual runs, so pull_request jobs never run here
#
# Trust boundary: a job runs as moduo-ci and can change anything moduo-ci owns, so nothing that
# decides what runs next is moduo-ci's. The runner lives in /Library/Moduo/actions-runner, owned by
# root (its directory is sticky and group-writable only so the runner can add its own state files;
# it can't replace root's), with self-update off: re-running this script updates it. The hook, its
# .env and the plist are root's too. Everything root does inside moduo-ci's home runs as moduo-ci
# (as_ci), so a link a job plants there can't turn a re-run of this script against you.
set -euo pipefail

REPO="${MODUO_RUNNER_REPO:-GrochowskiMichal/Moduo}"
CI_USER=moduo-ci
CI_HOME=/Users/$CI_USER
RUNNER_NAME=moduo-mac
MODUO_DIR=/Library/Moduo
RUNNER_DIR=$MODUO_DIR/actions-runner
CACHE_DIR=$CI_HOME/cache
STATE_DIR=$CI_HOME/.moduo-ci
KEYCHAIN=$CI_HOME/Library/Keychains/moduo-signing.keychain-db
KEYCHAIN_PASSWORD_FILE=$STATE_DIR/keychain-password
NOTARY_PROFILE=moduo-notary
LABEL=com.moduo.actions-runner
PLIST=/Library/LaunchDaemons/$LABEL.plist
HOOK_DIR=$MODUO_DIR/mac-runner
LOG_DIR=$MODUO_DIR/logs
LOG=$LOG_DIR/actions-runner.log
CI_PATH=$CI_HOME/.cargo/bin:$CI_HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/../.." && pwd)"
ADMIN_USER="${SUDO_USER:-}"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
doing() { printf '  → %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ask() { local a; read -r -p "  $1 [y/N] " a </dev/tty; [[ "$a" =~ ^[Yy] ]]; }

# Commands as the runner user, from a directory it can read, with its own PATH.
as_ci() { (cd / && sudo -u "$CI_USER" -H /usr/bin/env PATH="$CI_PATH" "$@"); }
# Commands as you (gh is signed in as you).
as_admin() { (cd / && sudo -u "$ADMIN_USER" -H "$@"); }

preflight() {
  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || die "This is for an Apple Silicon Mac."
  [ "$EUID" = 0 ] || die "Run it with sudo: sudo $0 ${*:-}"
  [ -n "$ADMIN_USER" ] && [ "$ADMIN_USER" != root ] || die "Run it with sudo from your own account, not as root."
  ADMIN_HOME="$(dscl . -read "/Users/$ADMIN_USER" NFSHomeDirectory | awk '{print $2}')"
  RUST_CHANNEL="$(sed -n 's/^channel *= *"\(.*\)"/\1/p' "$REPO_ROOT/apps/desktop/src-tauri/rust-toolchain.toml")"
  BUN_VERSION="$(tr -d '[:space:]' <"$REPO_ROOT/.bun-version")"
  [ -n "$RUST_CHANNEL" ] && [ -n "$BUN_VERSION" ] || die "Run this from a Moduo checkout (rust-toolchain.toml / .bun-version not found)."
}

gh_admin() { as_admin gh "$@"; }

# ─── user ────────────────────────────────────────────────────────────────────────────────────────
setup_user() {
  bold "1. The runner user ($CI_USER)"
  if ! dscl . -read "/Groups/$CI_USER" >/dev/null 2>&1; then
    doing "creating group $CI_USER"
    dseditgroup -o create -r "Moduo CI" "$CI_USER"
  fi
  local gid
  gid="$(dscl . -read "/Groups/$CI_USER" PrimaryGroupID | awk '{print $2}')"
  if id "$CI_USER" >/dev/null 2>&1; then
    ok "user exists"
  else
    doing "creating standard user $CI_USER (random password nobody needs; it never logs in)"
    sysadminctl -addUser "$CI_USER" -fullName "Moduo CI" -home "$CI_HOME" -shell /bin/zsh \
      -password "$(openssl rand -base64 32)" 2>&1 | grep -v -i "securetoken" || true
    id "$CI_USER" >/dev/null 2>&1 || die "Creating $CI_USER failed."
  fi
  # Its own primary group, so it isn't in `staff` with you; hidden from the login window.
  dscl . -create "/Users/$CI_USER" PrimaryGroupID "$gid"
  dscl . -create "/Users/$CI_USER" IsHidden 1
  if dseditgroup -o checkmember -m "$CI_USER" admin >/dev/null 2>&1; then
    doing "removing $CI_USER from admin"
    dseditgroup -o edit -d "$CI_USER" -t user admin
  fi
  [ -d "$CI_HOME" ] || createhomedir -c -u "$CI_USER" >/dev/null
  [ ! -L "$CI_HOME" ] || die "$CI_HOME is a symlink."
  # Root touches the home itself (in root-owned /Users) and nothing below it: a job could have
  # swapped anything below for a symlink.
  chown "$CI_USER:$CI_USER" "$CI_HOME"
  chmod 700 "$CI_HOME"
  as_ci /bin/sh -c "umask 022; mkdir -p '$CACHE_DIR/cargo-target' '$CACHE_DIR/bun' '$CI_HOME/Library/Keychains' && umask 077 && mkdir -p '$STATE_DIR'"
  ok "standard user, group $CI_USER, home $CI_HOME (700), cache $CACHE_DIR"

  # macOS makes homes 750 with group staff. moduo-ci isn't in staff, so only the "other" bits matter.
  local mode
  mode="$(stat -f %Lp "$ADMIN_HOME")"
  if [ $((8#$mode & 7)) != 0 ]; then
    warn "your home $ADMIN_HOME is $mode: every local account, $CI_USER included, can read parts of it"
    if ask "Remove access for other accounts (chmod o-rwx $ADMIN_HOME)?"; then
      chmod o-rwx "$ADMIN_HOME"
    else
      warn "left as $mode; --verify will fail the isolation check"
    fi
  fi
  ok "$ADMIN_HOME is $(stat -f %Lp "$ADMIN_HOME"), and $CI_USER is in neither your group nor admin"
}

# ─── toolchain ───────────────────────────────────────────────────────────────────────────────────
setup_toolchain() {
  bold "2. Toolchain (Xcode, rustup $RUST_CHANNEL, Bun $BUN_VERSION)"
  if ! { xcode-select -p && xcrun -f notarytool && xcrun -f stapler; } >/dev/null 2>&1; then
    die "Xcode command line tools are missing. Run: xcode-select --install"
  fi
  ok "Xcode tools at $(xcode-select -p)"

  local tmp
  tmp="$(as_ci mktemp -d)"
  if ! as_ci test -x "$CI_HOME/.cargo/bin/rustup"; then
    doing "installing rustup"
    local url=https://static.rust-lang.org/rustup/dist/aarch64-apple-darwin/rustup-init want
    as_ci curl -fsSL -o "$tmp/rustup-init" "$url"
    want="$(curl -fsSL "$url.sha256" | awk '{print $1}')"
    [ "$(shasum -a 256 "$tmp/rustup-init" | awk '{print $1}')" = "$want" ] || die "rustup-init checksum mismatch."
    as_ci chmod +x "$tmp/rustup-init"
    as_ci "$tmp/rustup-init" -y --no-modify-path --profile minimal --default-toolchain none >/dev/null
  fi
  doing "rust $RUST_CHANNEL + both Apple targets"
  as_ci rustup toolchain install "$RUST_CHANNEL" --profile minimal --component rustfmt,clippy \
    --target aarch64-apple-darwin,x86_64-apple-darwin >/dev/null 2>&1
  as_ci rustup target add --toolchain "$RUST_CHANNEL" aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1
  as_ci rustup default "$RUST_CHANNEL" >/dev/null 2>&1
  ok "rustup $(as_ci rustc +"$RUST_CHANNEL" --version | awk '{print $2}')"

  if [ "$(as_ci "$CI_HOME/.bun/bin/bun" --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
    doing "installing Bun $BUN_VERSION"
    local base="https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION" want
    as_ci curl -fsSL -o "$tmp/bun.zip" "$base/bun-darwin-aarch64.zip"
    want="$(curl -fsSL "$base/SHASUMS256.txt" | awk '$2 == "bun-darwin-aarch64.zip" {print $1}')"
    [ -n "$want" ] && [ "$(shasum -a 256 "$tmp/bun.zip" | awk '{print $1}')" = "$want" ] || die "Bun checksum mismatch."
    as_ci unzip -qo "$tmp/bun.zip" -d "$tmp"
    as_ci install -d "$CI_HOME/.bun/bin"
    as_ci install -m 755 "$tmp/bun-darwin-aarch64/bun" "$CI_HOME/.bun/bin/bun"
  fi
  ok "bun $(as_ci "$CI_HOME/.bun/bin/bun" --version)"
  as_ci rm -rf "$tmp"
}

# ─── keychain ────────────────────────────────────────────────────────────────────────────────────
kc_password() { as_ci cat "$KEYCHAIN_PASSWORD_FILE"; }
unlock_keychain() { as_ci security unlock-keychain -p "$(kc_password)" "$KEYCHAIN"; }
devid_count() { as_ci security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -c '"Developer ID Application:' || true; }
identity_count() { as_ci security find-identity -v -p codesigning "$KEYCHAIN" 2>/dev/null | grep -cE '^ +[0-9]+\)' || true; }
notary_ok() { as_ci xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" --keychain "$KEYCHAIN" >/dev/null 2>&1; }

setup_keychain() {
  bold "3. Signing keychain (Developer ID + notarization only)"
  if ! as_ci test -s "$KEYCHAIN_PASSWORD_FILE"; then
    as_ci /bin/sh -c "umask 077; openssl rand -hex 24 > '$KEYCHAIN_PASSWORD_FILE'"
  fi
  if ! as_ci test -f "$KEYCHAIN"; then
    doing "creating $KEYCHAIN"
    as_ci security create-keychain -p "$(kc_password)" "$KEYCHAIN"
  fi
  # No auto-lock and no lock on sleep: a lock mid-build breaks codesign (errSecInternalComponent).
  as_ci security set-keychain-settings "$KEYCHAIN"
  unlock_keychain
  as_ci security list-keychains -d user -s "$KEYCHAIN" || true
  as_ci security default-keychain -d user -s "$KEYCHAIN" || true

  if [ "$(devid_count)" -ge 1 ] && [ "${REIMPORT_CERT:-}" != 1 ]; then
    ok "Developer ID identity present ($(as_ci security find-identity -v -p codesigning "$KEYCHAIN" | sed -n 's/.*"\(.*\)"/\1/p' | head -1))"
  else
    echo "  The Developer ID Application certificate, exported as a .p12 (README step 1)."
    local p12 pw default="$ADMIN_HOME/Desktop/moduo-developer-id.p12"
    read -r -p "  Path to the .p12 [$default]: " p12 </dev/tty
    p12="${p12:-$default}"
    [ -f "$p12" ] || die "No file at $p12."
    read -r -s -p "  The .p12's export password: " pw </dev/tty
    echo
    # A renewed certificate replaces the old one: two identities with one name make codesign fail.
    local h
    for h in $(as_ci security find-identity -p codesigning "$KEYCHAIN" | awk '/^ +[0-9]+\)/ {print $2}' | sort -u); do
      as_ci security delete-identity -Z "$h" "$KEYCHAIN" >/dev/null
    done
    # Copied by moduo-ci itself (root never writes into its home). -x: the key can't be exported again.
    as_ci /bin/sh -c "umask 077; cat > '$STATE_DIR/import.p12'" <"$p12"
    as_ci security import "$STATE_DIR/import.p12" -k "$KEYCHAIN" -P "$pw" -x -T /usr/bin/codesign >/dev/null ||
      { as_ci rm -f "$STATE_DIR/import.p12"; die "Import failed (wrong password?)."; }
    as_ci rm -f "$STATE_DIR/import.p12"
    as_ci security set-key-partition-list -S apple-tool:,apple: -s -k "$(kc_password)" "$KEYCHAIN" >/dev/null
    [ "$(devid_count)" -ge 1 ] || die "The .p12 holds no valid Developer ID Application identity."
    ok "imported $(as_ci security find-identity -v -p codesigning "$KEYCHAIN" | sed -n 's/.*"\(.*\)"/\1/p' | head -1)"
    if ask "Delete $p12 now? (The identity stays in your login keychain.)"; then
      rm -f "$p12" && ok "deleted $p12"
    fi
  fi
  [ "$(identity_count)" = 1 ] || warn "the keychain holds $(identity_count) signing identities; it should hold exactly one"

  if notary_ok; then
    ok "notarization profile '$NOTARY_PROFILE' works"
  else
    echo "  Now the notarization login, stored in this keychain as profile '$NOTARY_PROFILE'."
    echo "  notarytool asks for it: an App Store Connect API key (.p8 path, key ID, issuer ID) or your"
    echo "  Apple ID, team ID and an app-specific password (README step 2). It checks the login with Apple."
    as_ci xcrun notarytool store-credentials "$NOTARY_PROFILE" --keychain "$KEYCHAIN" </dev/tty
    notary_ok || die "Apple did not accept the stored notarization login."
    ok "notarization profile '$NOTARY_PROFILE' works"
  fi
}

# ─── runner ──────────────────────────────────────────────────────────────────────────────────────
registration_token() {
  local t
  if t="$(gh_admin api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token 2>/dev/null)" && [ -n "$t" ]; then
    printf '%s' "$t"
    return
  fi
  echo "  Couldn't get a registration token with gh. In another terminal tab run:" >&2
  echo "    gh api -X POST repos/$REPO/actions/runners/registration-token --jq .token" >&2
  read -r -s -p "  and paste the token here: " t </dev/tty
  echo >&2
  printf '%s' "$t"
}

write_plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>UserName</key><string>$CI_USER</string>
  <key>GroupName</key><string>$CI_USER</string>
  <!-- Its own security session, so the job can unlock and use moduo-ci's keychain with nobody logged in. -->
  <key>SessionCreate</key><true/>
  <key>ProgramArguments</key><array><string>$RUNNER_DIR/run.sh</string></array>
  <key>WorkingDirectory</key><string>$RUNNER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>$CI_HOME</string>
    <key>USER</key><string>$CI_USER</string>
    <key>LOGNAME</key><string>$CI_USER</string>
    <key>PATH</key><string>$CI_PATH</string>
    <key>LANG</key><string>en_US.UTF-8</string>
    <key>CARGO_TARGET_DIR</key><string>$CACHE_DIR/cargo-target</string>
    <key>BUN_INSTALL_CACHE_DIR</key><string>$CACHE_DIR/bun</string>
    <key>MODUO_SIGNING_KEYCHAIN</key><string>$KEYCHAIN</string>
    <key>MODUO_NOTARY_PROFILE</key><string>$NOTARY_PROFILE</string>
    <key>ACTIONS_RUNNER_HOOK_JOB_STARTED</key><string>$HOOK_DIR/job-started.sh</string>
  </dict>
</dict>
</plist>
EOF
}

service_running() { launchctl print "system/$LABEL" 2>/dev/null | grep -q 'state = running'; }

runner_status() {
  gh_admin api "repos/$REPO/actions/runners?per_page=100" \
    --jq ".runners[] | select(.name == \"$RUNNER_NAME\") | \"\(.status) busy=\(.busy) labels=\([.labels[].name] | join(\",\"))\"" 2>/dev/null
}

latest_runner() {
  local rel
  rel="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest)"
  RUNNER_LATEST="$(printf '%s' "$rel" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))')"
  RUNNER_SHA="$(printf '%s' "$rel" | python3 -c 'import json,re,sys; m=re.search(r"<!-- BEGIN SHA osx-arm64 -->([0-9a-f]{64})<!-- END SHA osx-arm64 -->", json.load(sys.stdin)["body"]); print(m.group(1) if m else "")')"
  [ -n "$RUNNER_LATEST" ] && [ -n "$RUNNER_SHA" ] || die "Couldn't read the latest runner release and its checksum."
}

stop_service() { if service_running; then launchctl bootout "system/$LABEL" 2>/dev/null && sleep 2 || true; fi; }

# Root owns the runner's code and config; moduo-ci owns only its state (registration, logs, work).
# moduo-ci can add entries to the runner dir (sticky, group-writable), so root never follows one:
# a symlink or a hard link (link count > 1) planted there is removed, not chowned.
STATE_FILES=" .runner .credentials .credentials_rsaparams .runner_migrated .credentials_migrated "
planted() { [ -L "$1" ] || { [ -f "$1" ] && [ "$(stat -f %l "$1")" != 1 ]; }; }
lock_runner_dir() {
  chown -h "root:$CI_USER" "$RUNNER_DIR"
  chmod 1775 "$RUNNER_DIR"
  local p f
  for p in "$RUNNER_DIR"/* "$RUNNER_DIR"/.[!.]*; do
    [ -e "$p" ] || [ -L "$p" ] || continue
    f="${p##*/}"
    if planted "$p"; then
      rm -f "$p"
    elif [[ "$STATE_FILES" == *" $f "* ]]; then
      chown -h "$CI_USER:$CI_USER" "$p"
      chmod 600 "$p"
    elif [ "$f" != _work ] && [ "$f" != _diag ]; then
      chown -R -P root:wheel "$p"
      chmod -R go-w "$p"
    fi
  done
  for f in _work _diag; do
    [ -d "$RUNNER_DIR/$f" ] || install -d -o "$CI_USER" -g "$CI_USER" -m 755 "$RUNNER_DIR/$f"
  done
  # The runner reads these at start; root's copies decide PATH and the hook, not a job's.
  # Written in root's own dir and renamed in: a rename replaces whatever moduo-ci put there.
  printf '%s' "$CI_PATH" >"$HOOK_DIR/runner.path"
  printf 'LANG=en_US.UTF-8\nACTIONS_RUNNER_HOOK_JOB_STARTED=%s\n' "$HOOK_DIR/job-started.sh" >"$HOOK_DIR/runner.env"
  chmod 644 "$HOOK_DIR/runner.path" "$HOOK_DIR/runner.env"
  mv -f "$HOOK_DIR/runner.path" "$RUNNER_DIR/.path"
  mv -f "$HOOK_DIR/runner.env" "$RUNNER_DIR/.env"
}

setup_runner() {
  bold "4. GitHub Actions runner ($RUNNER_NAME → $REPO)"
  install -d -o root -g wheel -m 755 "$MODUO_DIR" "$HOOK_DIR" "$LOG_DIR"
  [ ! -L "$RUNNER_DIR" ] || die "$RUNNER_DIR is a symlink."

  # Self-update is off (it would need moduo-ci to own the code), so this keeps it current. GitHub
  # stops sending jobs to a runner that's too old: it shows offline and builds go to GitHub's Mac.
  latest_runner
  local installed=""
  [ -f "$HOOK_DIR/runner-version" ] && installed="$(cat "$HOOK_DIR/runner-version")"
  if [ "$installed" != "$RUNNER_LATEST" ] || [ ! -x "$RUNNER_DIR/config.sh" ]; then
    doing "installing actions-runner $RUNNER_LATEST${installed:+ (was $installed)}"
    local tmp
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/runner.tgz" "https://github.com/actions/runner/releases/download/v$RUNNER_LATEST/actions-runner-osx-arm64-$RUNNER_LATEST.tar.gz"
    [ "$(shasum -a 256 "$tmp/runner.tgz" | awk '{print $1}')" = "$RUNNER_SHA" ] || die "Runner checksum mismatch."
    stop_service
    install -d -o root -g wheel -m 755 "$RUNNER_DIR"
    rm -rf "${RUNNER_DIR:?}/bin" "${RUNNER_DIR:?}/externals"
    tar -xzf "$tmp/runner.tgz" -C "$RUNNER_DIR"
    rm -rf "$tmp"
    printf '%s' "$RUNNER_LATEST" >"$HOOK_DIR/runner-version"
  fi
  lock_runner_dir
  ok "runner $RUNNER_LATEST in $RUNNER_DIR (root-owned)"

  if [ ! -f "$RUNNER_DIR/.runner" ] || [ "${REREGISTER:-}" = 1 ]; then
    doing "registering $RUNNER_NAME (labels self-hosted, macOS, ARM64, moduo-mac)"
    local token
    token="$(registration_token)"
    [ -n "$token" ] || die "No registration token."
    stop_service
    rm -f "$RUNNER_DIR/.runner" "$RUNNER_DIR/.credentials" "$RUNNER_DIR/.credentials_rsaparams" \
      "$RUNNER_DIR/.runner_migrated" "$RUNNER_DIR/.credentials_migrated" "$RUNNER_DIR/.env" "$RUNNER_DIR/.path"
    (cd / && sudo -u "$CI_USER" -H /usr/bin/env PATH="$CI_PATH" /bin/bash -c \
      'cd "$1" && ./config.sh --unattended --replace --disableupdate --url "https://github.com/$2" --token "$3" --name "$4" --labels moduo-mac --work _work' \
      _ "$RUNNER_DIR" "$REPO" "$token" "$RUNNER_NAME") >/dev/null
    lock_runner_dir
  fi
  ok "registered"

  install -o root -g wheel -m 755 "$SRC_DIR/job-started.sh" "$HOOK_DIR/job-started.sh"
  ok "job-started hook at $HOOK_DIR/job-started.sh (root-owned)"

  # In a root-owned directory, so the file can't be swapped for a link to something of root's.
  [ -f "$LOG" ] || install -o "$CI_USER" -g "$CI_USER" -m 644 /dev/null "$LOG"
  local new
  new="$(mktemp)"
  write_plist >"$new"
  plutil -lint -s "$new" || die "Generated plist is invalid."
  if ! cmp -s "$new" "$PLIST" || ! service_running; then
    install -o root -g wheel -m 644 "$new" "$PLIST"
    stop_service
    launchctl enable "system/$LABEL"
    launchctl bootstrap system "$PLIST"
    doing "LaunchDaemon $LABEL (re)started"
  fi
  rm -f "$new"
  ok "service $LABEL $(service_running && echo running || echo 'NOT running')"

  doing "waiting for GitHub to see $RUNNER_NAME online"
  local s=""
  for _ in $(seq 1 20); do
    s="$(runner_status || true)"
    [[ "$s" == online* ]] && break
    sleep 3
  done
  if [[ "$s" == online* ]]; then ok "GitHub: $s"; else warn "GitHub says: ${s:-not listed}. Log: $LOG"; fi
}

# ─── verify ──────────────────────────────────────────────────────────────────────────────────────
FAILS=0
check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then ok "$name"; else
    printf '  \033[31m✗\033[0m %s\n' "$name"
    FAILS=$((FAILS + 1))
  fi
}
not() { ! "$@"; }
hook() { env -i MODUO_HOOK_DRY_RUN=1 GITHUB_REPOSITORY_OWNER="${REPO%%/*}" GITHUB_EVENT_NAME="$1" GITHUB_REF="$2" GITHUB_TRIGGERING_ACTOR="$3" /bin/bash "$HOOK_DIR/job-started.sh"; }
has_line() { local want="$1"; shift; "$@" 2>/dev/null | grep -qF -- "$want"; }
owned_by_root_not_writable() { [ "$(stat -f '%Su %Lp' "$1")" = "root 755" ] || [ "$(stat -f '%Su %Lp' "$1")" = "root 644" ]; }
gate_files_root_owned() {
  local f
  for f in "$HOOK_DIR" "$HOOK_DIR/job-started.sh" "$PLIST" "$RUNNER_DIR/run.sh" "$RUNNER_DIR/run-helper.sh" "$RUNNER_DIR/bin" "$RUNNER_DIR/externals" "$RUNNER_DIR/.env" "$RUNNER_DIR/.path"; do
    owned_by_root_not_writable "$f" || return 1
  done
  [ -z "$(find "$RUNNER_DIR/bin" "$RUNNER_DIR/externals" ! -user root -print -quit)" ]
}
listener_runs_as_ci() { service_running && pgrep -u "$CI_USER" -f Runner.Listener; }
admin_login_keychain="" # set in verify

verify() {
  admin_login_keychain="$ADMIN_HOME/Library/Keychains/login.keychain-db"
  bold "Isolation ($CI_USER can't read your home or keychain)"
  check "$CI_USER exists" id "$CI_USER"
  check "$CI_USER is not an admin" not dseditgroup -o checkmember -m "$CI_USER" admin
  check "$CI_USER is not in staff" not dseditgroup -o checkmember -m "$CI_USER" staff
  check "$CI_USER can't use sudo" not as_ci sudo -n true
  check "$CI_USER can't list $ADMIN_HOME" not as_ci ls "$ADMIN_HOME"
  check "$CI_USER can't read your login keychain" not as_ci test -r "$admin_login_keychain"
  check "$CI_USER can't read your gh login" not as_ci test -r "$ADMIN_HOME/.config/gh/hosts.yml"
  check "$CI_USER can't read your ~/.ssh" not as_ci ls "$ADMIN_HOME/.ssh"
  check "$CI_USER's search list doesn't include your keychains" not has_line "$ADMIN_HOME" as_ci security list-keychains -d user
  check "your home has no access for other accounts" test "$(($(printf '8#%s' "$(stat -f %Lp "$ADMIN_HOME")") & 7))" = 0
  check "$CI_USER's home is private" test "$(stat -f '%Su %Lp' "$CI_HOME")" = "$CI_USER 700"

  bold "Keychain (Developer ID + notarization only)"
  check "keychain unlocks with its stored password" unlock_keychain
  check "exactly one signing identity, a Developer ID Application" test "$(identity_count)/$(devid_count)" = "1/1"
  check "notarization profile '$NOTARY_PROFILE' is accepted by Apple" notary_ok
  check "password file is 600 and moduo-ci's" test "$(stat -f '%Su %Lp' "$KEYCHAIN_PASSWORD_FILE")" = "$CI_USER 600"

  bold "Toolchain"
  check "Xcode tools (notarytool, stapler)" xcrun -f stapler
  check "rust $RUST_CHANNEL installed" has_line "$RUST_CHANNEL" as_ci rustup toolchain list
  check "target aarch64-apple-darwin" has_line aarch64-apple-darwin as_ci rustup target list --installed --toolchain "$RUST_CHANNEL"
  check "target x86_64-apple-darwin" has_line x86_64-apple-darwin as_ci rustup target list --installed --toolchain "$RUST_CHANNEL"
  check "bun $BUN_VERSION" test "$(as_ci "$CI_HOME/.bun/bin/bun" --version 2>/dev/null)" = "$BUN_VERSION"
  check "persistent cache dirs are moduo-ci's" test "$(stat -f %Su "$CACHE_DIR/cargo-target")/$(stat -f %Su "$CACHE_DIR/bun")" = "$CI_USER/$CI_USER"

  bold "Trigger rules (job-started hook)"
  check "hook, plist and runner code are root-owned, not writable by $CI_USER" gate_files_root_owned
  check "runner directory is root's and sticky" test "$(stat -f '%Su %Lp' "$RUNNER_DIR")" = "root 1775"
  check "$CI_USER can't change the runner's .env" not as_ci test -w "$RUNNER_DIR/.env"
  check "$CI_USER can't replace the runner's code" not as_ci test -w "$RUNNER_DIR/bin"
  check "runner self-update is off" grep -q '"disableUpdate": *true' "$RUNNER_DIR/.runner"
  check "plist runs the hook" has_line "$HOOK_DIR/job-started.sh" cat "$PLIST"
  check ".env runs the hook" has_line "$HOOK_DIR/job-started.sh" cat "$RUNNER_DIR/.env"
  check "refuses pull_request" not hook pull_request refs/pull/1/merge "${REPO%%/*}"
  check "refuses pull_request_target" not hook pull_request_target refs/heads/develop "${REPO%%/*}"
  check "refuses schedule" not hook schedule refs/heads/develop "${REPO%%/*}"
  check "refuses push to a feature branch" not hook push refs/heads/t/mike/x "${REPO%%/*}"
  check "refuses a manual run by someone else" not hook workflow_dispatch refs/heads/develop someone-else
  check "accepts push to develop" hook push refs/heads/develop someone-else
  check "accepts push to mike" hook push refs/heads/mike "${REPO%%/*}"
  check "accepts a v* tag" hook push refs/tags/v1.2.0 "${REPO%%/*}"
  check "accepts the owner's manual run" hook workflow_dispatch refs/heads/develop "${REPO%%/*}"

  bold "Service"
  check "LaunchDaemon $LABEL is running as $CI_USER" listener_runs_as_ci
  local s
  s="$(runner_status || true)"
  if [[ "$s" == online* ]]; then ok "GitHub: $RUNNER_NAME $s"; else
    printf '  \033[31m✗\033[0m GitHub: %s is %s\n' "$RUNNER_NAME" "${s:-not listed (or gh could not read runners)}"
    FAILS=$((FAILS + 1))
  fi
  local policy
  policy="$(gh_admin api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq .approval_policy 2>/dev/null || true)"
  if [ "$policy" = all_external_contributors ]; then ok "fork PR workflows need approval for all outside contributors"; else
    printf '  \033[31m✗\033[0m fork PR approval policy is %s; README step 4 sets it to all outside contributors\n' "'${policy:-unknown}'"
    FAILS=$((FAILS + 1))
  fi

  echo
  if [ "$FAILS" = 0 ]; then printf '\033[32mAll checks passed.\033[0m\n'; else printf '\033[31m%s check(s) failed.\033[0m\n' "$FAILS"; exit 1; fi
}

main() {
  local mode="${1:-setup}"
  preflight "$@"
  case "$mode" in
    setup | --reregister | --reimport-cert)
      [ "$mode" = --reregister ] && REREGISTER=1
      [ "$mode" = --reimport-cert ] && REIMPORT_CERT=1
      setup_user
      setup_toolchain
      setup_keychain
      setup_runner
      bold "Done. Now run: sudo $0 --verify"
      ;;
    --verify) verify ;;
    --stop)
      launchctl disable "system/$LABEL"
      launchctl bootout "system/$LABEL" 2>/dev/null || true
      ok "stopped, also across reboots; GitHub shows $RUNNER_NAME offline within a minute or so, and desktop builds go to macos-latest"
      ;;
    --start)
      launchctl enable "system/$LABEL"
      launchctl bootstrap system "$PLIST" 2>/dev/null || launchctl kickstart -k "system/$LABEL"
      ok "started"
      ;;
    *) die "Unknown option $mode. Use --verify, --stop, --start, --reregister or --reimport-cert." ;;
  esac
}

main "$@"
