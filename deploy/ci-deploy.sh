#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
docker_config="$(mktemp -d)"
trap 'rm -rf "$docker_config"' EXIT
export DOCKER_CONFIG="$docker_config"
if [[ "${1:-}" == up ]]; then
  # JSON arrives only over SSH stdin; no credentials enter command arguments or logs.
  python3 -c '
import json, os, sys
data = json.load(sys.stdin)
directory = os.environ["DOCKER_CONFIG"]
with open(directory + "/registry-token", "w") as f:
    f.write(data["registryToken"])
settings = data["typesafe"]
with open(directory + "/typesafe.env", "w") as f:
    for key in ["TYPESAFE_API_KEY", "TYPESAFE_MODEL", "TYPESAFE_MAX_REQUESTS", "TYPESAFE_MAX_REQUESTS_PER_MATCH", "TYPESAFE_DECISION_TIMEOUT_MS"]:
        value = str(settings[key])
        if "\n" in value or "\r" in value:
            raise ValueError("Invalid multiline deployment setting")
        quote = chr(39)
        f.write(key + "=" + quote + value.replace(quote, "\\" + quote) + quote + "\n")
'
  docker login ghcr.io --username "${GHCR_USER:?Set GHCR_USER}" --password-stdin < "$docker_config/registry-token"
  export TYPESAFE_SETTINGS_FILE="$docker_config/typesafe.env"
fi
bash deploy/deploy.sh "$@"
