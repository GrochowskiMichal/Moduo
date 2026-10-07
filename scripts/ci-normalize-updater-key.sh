#!/usr/bin/env bash
# Print TAURI_SIGNING_PRIVATE_KEY with whitespace and trailing junk removed.
# `tauri signer generate` stores one base64 line, often ending in "=".
# A character after that padding (a second pasted value) makes Tauri report
# "Invalid symbol 61" at the "=" and the Windows installer is thrown away.
set -euo pipefail
python3 - <<'PY'
import os
import sys

raw = "".join(os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "").split())
if not raw:
    sys.exit("TAURI_SIGNING_PRIVATE_KEY is empty")
pad_at = raw.find("=")
body = raw if pad_at < 0 else raw[:pad_at]
if len(body) % 4 == 1:
    sys.exit("TAURI_SIGNING_PRIVATE_KEY is not valid base64")
body += "=" * ((-len(body)) % 4)
sys.stdout.write(body)
PY
