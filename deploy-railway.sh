#!/bin/bash
# Run after `railway login`. Never prints secret values.
set -euo pipefail
cd ~/Developer/kloel-prod
ENVF=~/Documents/Codex/2026-10-18/t-o-seguinte-eu-paguei-pra/outputs/kloel-engine.nosync/.env.local
railway whoami
[ -f .railway-linked ] || { railway init --name kloel; railway add --service kloel; touch .railway-linked; }
railway service kloel
railway volume add --mount-path /data || true
DOMAIN=$(railway domain --service kloel --json 2>/dev/null | sed -nE 's/.*"domain": *"([^"]+)".*/\1/p' | head -1)
[ -n "$DOMAIN" ] || DOMAIN=$(railway domain --service kloel 2>&1 | grep -oE '[a-z0-9-]+\.up\.railway\.app' | head -1)
DOMAIN="${DOMAIN#https://}"
echo "Railway domain: $DOMAIN"
# Production variables live in Railway (Stripe LIVE since 2026-10-20). Copying the local .env.local over them
# would revert live keys to test ones, so it only happens when explicitly requested with SYNC_LOCAL_ENV=1.
BASE="${PUBLIC_ORIGIN:-https://www.kloel.ai}"
if [ "${SYNC_LOCAL_ENV:-0}" = "1" ]; then
  args=()
  while IFS= read -r line; do
    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
    k="${line%%=*}"; v="${line#*=}"; v="${v%\"}"; v="${v#\"}"
    case "$k" in HOST|PORT|DATABASE_PATH|PUBLIC_BASE_URL|APP_ORIGIN|ALLOWED_ORIGINS|BILLING_RETURN_URL|COOKIE_SECURE) continue;; esac
    args+=(--set "$k=$v")
  done < "$ENVF"
  args+=(--set "PUBLIC_BASE_URL=$BASE" --set "APP_ORIGIN=$BASE" --set "BILLING_RETURN_URL=$BASE/app/billing" --set "ALLOWED_ORIGINS=https://$DOMAIN,https://kloel.ai,https://www.kloel.ai,https://api.kloel.ai")
  railway variables --service kloel --skip-deploys "${args[@]}" >/dev/null && echo "Set ${#args[@]} variables (values hidden)"
fi
railway up --service kloel --detach
echo "Deploy started. Check: curl https://$DOMAIN/health"
