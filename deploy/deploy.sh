#!/usr/bin/env bash
set -euo pipefail

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

mkdir -p stacks
env_file="stacks/${stack}.env"
if [[ "$action" == down ]]; then
  if [[ -f "$env_file" ]]; then
    docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml down --remove-orphans
    rm -f "$env_file"
  fi
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
printf 'STACK_NAME=%s\nHOSTNAME=%s\nIMAGE_TAG=%s\n' "$stack" "$host" "$tag" > "$env_file"
if ! docker compose -p "$stack" --env-file "$env_file" -f deploy/compose.app.yml up -d --wait --wait-timeout 120 --remove-orphans; then
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
