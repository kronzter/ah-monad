#!/usr/bin/env bash
# Vercel deployment helper (CLI only).
#   pnpm vercel:setup   link this folder to a Vercel project (log in first: `vercel login`)
#   pnpm vercel:env     copy the required variables from .env to the Vercel project (production)
#   pnpm deploy:vercel  deploy to production and print the URL
# Secrets are piped to `vercel env add` on stdin: never printed, never put on a command line.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null || { echo "missing: $1 (npm i -g vercel@latest)"; exit 1; }; }
need vercel
vercel whoami >/dev/null 2>&1 || { echo "not logged in: run 'vercel login' first"; exit 1; }

REQUIRED=(NETWORK RELAYER_PKS DEEPSEEK_API_KEY DEEPSEEK_MODEL DEMO_SEED)
OPTIONAL=(RPC_URL MIN_RELAYER_MON)

cmd_setup() { vercel link --yes; }

cmd_env() {
  [ -f .env ] || { echo ".env not found (copy .env.example and fill it in)"; exit 1; }
  set -a; . ./.env; set +a
  export NETWORK="${NETWORK:-monad-testnet}"
  for k in "${REQUIRED[@]}"; do
    [ -n "${!k:-}" ] || { echo "required variable $k is empty in .env"; exit 1; }
  done
  for k in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
    v="${!k:-}"; [ -n "$v" ] || continue
    for envname in production; do
      vercel env rm "$k" "$envname" --yes >/dev/null 2>&1 || true
      printf '%s' "$v" | vercel env add "$k" "$envname" >/dev/null
    done
    echo "set $k"
  done
  echo "done. Redeploy for changes to take effect: pnpm deploy:vercel"
}

cmd_deploy() {
  [ -d .vercel ] || cmd_setup
  vercel deploy --prod --yes
}

case "${1:-}" in
  setup) cmd_setup ;;
  env) cmd_env ;;
  deploy) cmd_deploy ;;
  *) echo "usage: $0 {setup|env|deploy}"; exit 1 ;;
esac
