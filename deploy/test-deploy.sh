#!/usr/bin/env bash
# Isolated deployment regression checks; no Docker daemon or credentials used.
set -euo pipefail
source_dir="$(cd "$(dirname "$0")" && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT
mkdir -p "$test_root/app/deploy" "$test_root/app/stacks" "$test_root/bin"
cp "$source_dir/deploy.sh" "$test_root/app/deploy/"
export SKYLO_DEPLOY_TEST_ROOT="$test_root"
export PATH="$test_root/bin:$PATH"
cat > "$test_root/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$SKYLO_DEPLOY_TEST_ROOT/docker.log"
if [[ " $* " == *' run '* && -f "$SKYLO_DEPLOY_TEST_ROOT/fail-preflight" ]]; then exit 1; fi
if [[ " $* " == *' up '* && -f "$SKYLO_DEPLOY_TEST_ROOT/fail-up" ]]; then
  rm "$SKYLO_DEPLOY_TEST_ROOT/fail-up"
  exit 1
fi
MOCK
chmod +x "$test_root/bin/docker"
env_file="$test_root/app/stacks/skylo-prod.env"
cat > "$env_file" <<'SETTINGS'
STACK_NAME=skylo-prod
HOSTNAME=skylo.pb-vps.org
IMAGE_TAG=0000000000000000000000000000000000000000
TYPESAFE_API_KEY=test-only-old
TYPESAFE_MAX_REQUESTS=0
SKYLO_ML_MANIFEST=/opt/skylo/models/frozen/manifest.json
SETTINGS
printf 'TYPESAFE_API_KEY=test-only-new\nTYPESAFE_MAX_REQUESTS=0\n' > "$test_root/ci-settings"
export TYPESAFE_SETTINGS_FILE="$test_root/ci-settings"
bash "$test_root/app/deploy/deploy.sh" up prod 1111111111111111111111111111111111111111 > /dev/null
grep -qx 'SKYLO_ML_MANIFEST=/opt/skylo/models/frozen/manifest.json' "$env_file"
grep -qx 'TYPESAFE_API_KEY=test-only-new' "$env_file"
grep -q 'run --rm --no-deps -T backend node scripts/ml-runtime-smoke.cjs' "$test_root/docker.log"
cp "$env_file" "$test_root/expected.env"
touch "$test_root/fail-preflight"
if bash "$test_root/app/deploy/deploy.sh" up prod 2222222222222222222222222222222222222222 > /dev/null; then
  echo 'Failed preflight was accepted' >&2; exit 1
fi
cmp "$env_file" "$test_root/expected.env"
rm "$test_root/fail-preflight"
touch "$test_root/fail-up"
if bash "$test_root/app/deploy/deploy.sh" up prod 3333333333333333333333333333333333333333 > /dev/null; then
  echo 'Failed container update was accepted' >&2; exit 1
fi
cmp "$env_file" "$test_root/expected.env"
unset TYPESAFE_SETTINGS_FILE
bash "$test_root/app/deploy/deploy.sh" up prod 4444444444444444444444444444444444444444 > /dev/null
grep -qx 'TYPESAFE_API_KEY=test-only-new' "$env_file"
grep -qx 'SKYLO_ML_MANIFEST=/opt/skylo/models/frozen/manifest.json' "$env_file"
echo 'PASS: CI/manual settings preserved; preflight and container failure roll back'
