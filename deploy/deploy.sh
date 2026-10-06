#!/usr/bin/env bash
set -euo pipefail
umask 077

# Run on the Hetzner host from /home/pb/apps/skylo.
cd "$(dirname "$0")/.."
action="${1:-}"
target="${2:-}"
number="${3:-}"
tag="${4:-}"

if [[ "$action" != up && "$action" != down ]]; then
  echo "Usage: deploy.sh up prod <sha> | up pr <number> <sha> | down pr <number>" >&2
  exit 2
fi
if [[ "$target" == prod ]]; then
  [[ "$action" == up && "$number" =~ ^[0-9a-f]{40}$ ]] || exit 2
  tag="$number"
  stack=skylo-prod
  host=skylo.pb-vps.org
elif [[ "$target" == pr && "$number" =~ ^[1-9][0-9]*$ ]]; then
  stack="skylo-pr-${number}"
  host="pr-${number}.skylo-dev.pb-vps.org"
  if [[ "$action" == up && ! "$tag" =~ ^[0-9a-f]{40}$ ]]; then exit 2; fi
else
  exit 2
fi

mkdir -p stacks models
env_file="stacks/${stack}.env"
if [[ "$action" == down ]]; then
  if [[ -f "$env_file" ]]; then
    docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml down --remove-orphans
    rm -f "$env_file"
  fi
  docker volume rm "${stack}_typesafe-usage" >/dev/null 2>&1 || true
  exit 0
fi

docker network inspect proxy >/dev/null 2>&1 || {
  echo 'Existing Traefik Docker network "proxy" not found' >&2
  exit 1
}

old_env=""
if [[ -f "$env_file" ]]; then
  old_env="$(cat "$env_file")"
fi
touch "$env_file"
chmod 600 "$env_file"
printf 'STACK_NAME=%s\nHOSTNAME=%s\nIMAGE_TAG=%s\n' "$stack" "$host" "$tag" > "$env_file"
if [[ -n "${TYPESAFE_SETTINGS_FILE:-}" ]]; then
  cat "$TYPESAFE_SETTINGS_FILE" >> "$env_file"
elif [[ -n "$old_env" ]]; then
  # Manual image updates/rollbacks retain the configured key and usage limits.
  printf '%s\n' "$old_env" | awk '/^TYPESAFE_/' >> "$env_file"
fi
if [[ -n "$old_env" ]]; then
  # Model activation is host-managed and survives CI image updates and rollbacks.
  printf '%s\n' "$old_env" | awk '/^SKYLO_ML_MANIFEST=/' >> "$env_file"
fi
update_stack() {
  local model_manifest
  model_manifest="$(awk '/^SKYLO_ML_MANIFEST=/ { sub(/^[^=]*=/, ""); print; exit }' "$env_file")"
  if [[ -n "$model_manifest" ]]; then
    # Test the candidate CPU runtime before replacing the running backend.
    docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml run --rm --no-deps -T backend \
      node scripts/ml-runtime-smoke.cjs "$model_manifest" 2 || return 1
  fi
  docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml up -d --wait --wait-timeout 120 --remove-orphans
}
if ! update_stack; then
  if [[ -n "$old_env" ]]; then
    printf '%s\n' "$old_env" > "$env_file"
    docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml up -d --wait --wait-timeout 120 --remove-orphans || true
  else
    docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml down --remove-orphans || true
    rm -f "$env_file"
  fi
  exit 1
fi
echo "Deployed https://${host} (${tag})"
