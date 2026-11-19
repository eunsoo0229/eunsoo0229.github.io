#!/usr/bin/env bash
# Start the local SearXNG used by MARTIALDEX self-hosted search.
# Runtime (source checkout + venv) lives outside the repo in ~/.martialdex-ai.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RT="${MARTIALDEX_AI_HOME:-$HOME/.martialdex-ai}"
SECRET_FILE="$RT/searxng.secret"
[ -f "$SECRET_FILE" ] || (umask 077; python3 -c 'import secrets;print(secrets.token_hex(32))' > "$SECRET_FILE")
export SEARXNG_SECRET="$(cat "$SECRET_FILE")"
export SEARXNG_SETTINGS_PATH="$HERE/settings.yml"
cd "$RT/searxng-src"
exec "$RT/venv-searxng/bin/python" -m searx.webapp
