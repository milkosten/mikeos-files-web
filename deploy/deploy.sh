#!/usr/bin/env bash
# Idempotent deploy of mikeos-files-web (the Drive UI) to the 242 host.
# Builds/starts ONLY the mikeos-files-web container; REPLACES the bare
# files.osmike.com Caddy block with UI + /api compat (see below) then reloads
# Caddy. Never touches any other container or block.
#
# The bare-host block after this deploy:
#   files.osmike.com {
#     handle /api/*  -> mikeos-files:8000      (legacy API clients keep working)
#     handle         -> mikeos-files-web:8075  (humans get the Drive)
#   }
# Canonical API host stays files-api.osmike.com (mikeos-files-cloud deploy.sh).
set -euo pipefail
APP_DIR="/opt/mikeos-files-web"
CADDYFILE="/opt/mikephotos/deploy/Caddyfile"

[ -f "${APP_DIR}/.env" ] || { echo "MISSING ${APP_DIR}/.env (needs COOKIE_SECRET)"; exit 1; }
mkdir -p /data/mikeos-files-web

echo "==> build + up (our container only)"
cd "${APP_DIR}"
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build

if grep -q "reverse_proxy mikeos-files-web:8075" "${CADDYFILE}"; then
  echo "   files.osmike.com already routes to the Drive UI"
else
  cp "${CADDYFILE}" "${CADDYFILE}.bak.$(date +%s)"
  # Replace the plain API block for files.osmike.com with UI + /api compat.
  python3 - "$CADDYFILE" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path).read()
new_block = """files.osmike.com {
	encode zstd gzip
	handle /api/* {
		reverse_proxy mikeos-files:8000
	}
	handle {
		reverse_proxy mikeos-files-web:8075
	}
}"""
pat = re.compile(r"^files\.osmike\.com \{[^}]*?reverse_proxy mikeos-files:8000[^}]*?\}", re.M | re.S)
if pat.search(src):
    src = pat.sub(new_block, src, count=1)
else:
    src = src.rstrip() + "\n\n" + new_block + "\n"
open(path, "w").write(src)
print("   files.osmike.com block rewritten (UI + /api compat)")
PY
fi

echo "==> validate + graceful caddy reload"
docker exec deploy-caddy-1 caddy validate --config /etc/caddy/Caddyfile >/dev/null
docker exec deploy-caddy-1 caddy reload --config /etc/caddy/Caddyfile
sleep 2
echo "==> health:"
docker exec mikeos-files-web sh -c 'wget -qO- http://localhost:8075/healthz' || true
echo
