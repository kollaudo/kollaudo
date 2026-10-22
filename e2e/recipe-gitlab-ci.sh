#!/usr/bin/env bash
# Runs the pipeline of the GitLab CI recipe (docs/recipes/gitlab-ci.md) with gitlab-ci-local and its
# Docker executor, against Kollaudo, and checks its gate: when a test fails, the results are still
# sent and promote stops before the deployment; when the tests pass, promote deploys.
#
# The .gitlab-ci.yml is the one of the recipe, as written. Two things change: npx runs the CLI packed
# from the sources, so a CLI change that breaks the recipe shows up, and ./deploy.sh is a stub that
# says what it would deploy.
#
# Needs Docker, Kollaudo running in compose and the CLI built:
#   docker compose --profile app up -d --build --wait
#   pnpm build
#   e2e/recipe-gitlab-ci.sh
set -euo pipefail
cd "$(dirname "$0")/.."

GITLAB_CI_LOCAL=gitlab-ci-local@4.76.1
export KOLLAUDO_URL=${KOLLAUDO_URL:-http://localhost:8080}
# The jobs run in containers on the compose network, where Kollaudo answers as "kollaudo".
NETWORK=${KOLLAUDO_NETWORK:-kollaudo_default}
JOBS_URL=${KOLLAUDO_JOBS_URL:-http://kollaudo:8080}
read -ra ADMIN <<<"${KOLLAUDO_ADMIN:-docker compose exec -T kollaudo}"
RECIPE=docs/recipes/gitlab-ci.md
WORK=$(mktemp -d)
REPO=$WORK/repo
# The job containers can leave files that belong to root.
trap 'rm -rf "$WORK" 2>/dev/null || true' EXIT

fail() {
  echo "✗ $*" >&2
  exit 1
}

# Prints the log of one job of the last pipeline.
job_log() { cat "$REPO/.gitlab-ci-local/output/$1.log"; }

# Fails unless the log of a job contains the text.
expect_in_job() {
  job_log "$1" | grep -qF -- "$2" || {
    job_log "$1" >&2
    fail "expected the log of $1 to contain: $2"
  }
  echo "✓ $1: $2"
}

# Runs the pipeline and checks its exit code: 0 when every job passed.
pipeline() {
  local want=$1 got=0
  (cd "$REPO" && npx --yes "$GITLAB_CI_LOCAL" --network "$NETWORK" \
    --variable CI_COMMIT_REF_PROTECTED=true) >"$WORK/pipeline.log" 2>&1 || got=$?
  if [[ $want -eq 0 && $got -ne 0 ]] || [[ $want -ne 0 && $got -eq 0 ]]; then
    cat "$WORK/pipeline.log" >&2
    fail "the pipeline exited with $got, expected $([[ $want -eq 0 ]] && echo 0 || echo "an error")"
  fi
  echo "✓ the pipeline exited with $got"
}

curl -fsS "$KOLLAUDO_URL/healthz" >/dev/null || fail "Kollaudo isn't answering at $KOLLAUDO_URL."
[[ -f packages/cli/dist/main.js ]] || fail "Build the CLI first, with pnpm build."

echo "## 1. The pipeline of the recipe, with the CLI from the sources"
mkdir "$REPO"
awk '/^```yaml$/ { on = 1; next } on && /^```$/ { exit } on' "$RECIPE" >"$WORK/recipe.yml"
grep -q '^promote:$' "$WORK/recipe.yml" || fail "No .gitlab-ci.yml with a promote job in $RECIPE."
# The recipe pins the published CLI: the test runs the packed one in its place.
runs=$(grep -c 'npx --yes @kollaudo/cli@[0-9.]* ' "$WORK/recipe.yml" || true)
[[ $runs -eq 2 ]] || fail "Expected the recipe to run the CLI twice with npx, found $runs."
sed 's#npx --yes @kollaudo/cli@[0-9.]* #npx --yes --package ./kollaudo-cli.tgz kollaudo #' \
  "$WORK/recipe.yml" >"$REPO/.gitlab-ci.yml"
(cd packages/cli && pnpm pack --pack-destination "$WORK" >/dev/null)
mv "$WORK"/kollaudo-cli-*.tgz "$REPO/kollaudo-cli.tgz"

cp e2e/pytest/requirements.txt "$REPO/requirements-test.txt"
mkdir -p "$REPO/tests/e2e"
cat >"$REPO/deploy.sh" <<'EOF'
#!/bin/sh
echo "deploy.sh: deploying $2 to $1"
EOF
chmod +x "$REPO/deploy.sh"

# A project of its own, and the two tokens the recipe asks for, as CI/CD variables.
"${ADMIN[@]}" kollaudo-server project create "gitlab-ci-$(date +%s)" >"$WORK/tokens"
token() { awk -v scope="$1" '$1 == scope { print $2 }' "$WORK/tokens"; }
READ_TOKEN=$(token read)
cat >"$REPO/.gitlab-ci-local-variables.yml" <<EOF
KOLLAUDO_URL: $JOBS_URL
KOLLAUDO_TOKEN: $(token ingest)
KOLLAUDO_READ_TOKEN: $READ_TOKEN
EOF

# Each commit is a version: CI_COMMIT_SHORT_SHA, the first 8 characters of its SHA, as in GitLab.
commit() {
  git -C "$REPO" add -A
  git -C "$REPO" -c user.name=e2e -c user.email=e2e@example.com commit -qm "$1"
  git -C "$REPO" rev-parse HEAD | cut -c1-8
}
git -C "$REPO" init -q -b main
echo ".gitlab-ci-local*" >"$REPO/.gitignore"

echo "## 2. A test fails: the results are sent, and promote stops before the deployment"
cat >"$REPO/tests/e2e/test_staging.py" <<'EOF'
def test_home_page():
    assert True


def test_checkout():
    assert False, "the checkout is broken"
EOF
VERSION=$(commit "A broken checkout")
pipeline 1
expect_in_job send-results \
  "Sent 2 tests (e2e) from 1 JUnit file for api $VERSION on staging: 1 passed, 1 failed"
runs=$(curl -fsS -H "Authorization: Bearer $READ_TOKEN" \
  "$KOLLAUDO_URL/v1/test-runs?component=api&environment=staging&version=$VERSION" |
  node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () =>
    console.log(JSON.parse(s).items.length))')
[[ $runs -eq 1 ]] || fail "expected Kollaudo to store 1 test run of api $VERSION, found $runs"
echo "✓ Kollaudo stored the test run of api $VERSION"
expect_in_job promote "FAIL  api $VERSION in staging: e2e failed."
if job_log promote | grep -qF "deploy.sh: deploying"; then
  job_log promote >&2
  fail "promote deployed a version whose verdict is fail"
fi
echo "✓ promote didn't deploy $VERSION"

echo "## 3. The tests pass: promote deploys"
sed -i 's/assert False, "the checkout is broken"/assert True/' "$REPO/tests/e2e/test_staging.py"
VERSION=$(commit "A fixed checkout")
pipeline 0
expect_in_job send-results \
  "Sent 2 tests (e2e) from 1 JUnit file for api $VERSION on staging: 2 passed"
expect_in_job promote "PASS  api $VERSION in staging"
expect_in_job promote "deploy.sh: deploying $VERSION to production"
