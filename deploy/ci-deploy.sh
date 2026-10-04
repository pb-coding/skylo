#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker_config="$(mktemp -d)"
trap 'rm -rf "$docker_config"' EXIT
export DOCKER_CONFIG="$docker_config"
if [[ "${1:-}" == up ]]; then
  docker login ghcr.io --username "${GHCR_USER:?Set GHCR_USER}" --password-stdin
fi
bash deploy/deploy.sh "$@"
