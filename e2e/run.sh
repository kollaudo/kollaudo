#!/usr/bin/env bash
# End-to-end test of Kollaudo, as a team would use it (docs/milestones/v0.1.md, "Done when").
#
# Needs Kollaudo running from the sources, and the CLI built:
#   docker compose --profile app up -d --build --wait
#   pnpm build
#   e2e/run.sh
set -euo pipefail
cd "$(dirname "$0")"

export KOLLAUDO_URL=${KOLLAUDO_URL:-http://localhost:8080}
VERSION=${GITHUB_SHA:-$(git rev-parse HEAD)}
BRANCH=${GITHUB_HEAD_REF:-$(git rev-parse --abbrev-ref HEAD)}
RUN=$(date +%s)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

kollaudo() { node ../packages/cli/dist/main.js "$@"; }
admin() { docker compose -f ../compose.yaml exec -T kollaudo kollaudo-server "$@"; }

# Runs a command and checks its exit code. Its output goes to $OUT/out and $OUT/err.
expect_exit() {
  local want=$1 got=0
  shift
  "$@" >"$OUT/out" 2>"$OUT/err" || got=$?
  if [[ $got -ne $want ]]; then
    echo "✗ $* exited with $got, expected $want" >&2
    cat "$OUT/out" "$OUT/err" >&2
    exit 1
  fi
  echo "✓ $* → $want"
}

# Fails unless the output of the last command contains the text.
expect_output() {
  if ! grep -qF -- "$1" "$OUT/out" "$OUT/err"; then
    echo "✗ expected the output to contain: $1" >&2
    cat "$OUT/out" "$OUT/err" >&2
    exit 1
  fi
}

# Prints the token of a scope from the output of `project create`, without echoing it.
token() { awk -v scope="$1" '$1 == scope { print $2 }' "$2"; }

curl -fsS "$KOLLAUDO_URL/healthz" >/dev/null || {
  echo "Kollaudo isn't answering at $KOLLAUDO_URL. Start it with:" >&2
  echo "  docker compose --profile app up -d --build --wait" >&2
  exit 1
}

echo "## 1. Two projects, each with an ingest and a read token"
export E2E_PROJECT="e2e-shop-$RUN" E2E_OTHER_PROJECT="e2e-blog-$RUN"
admin project create "$E2E_PROJECT" >"$OUT/shop"
admin project create "$E2E_OTHER_PROJECT" >"$OUT/blog"
export E2E_INGEST_TOKEN=$(token ingest "$OUT/shop") E2E_READ_TOKEN=$(token read "$OUT/shop")
export E2E_OTHER_READ_TOKEN=$(token read "$OUT/blog")
OTHER_INGEST_TOKEN=$(token ingest "$OUT/blog")
export KOLLAUDO_TOKEN=$E2E_INGEST_TOKEN E2E_VERSION=$VERSION

echo "## 2. Kollaudo's own API tests, sent with kollaudo push"
pnpm exec playwright test tests/api.spec.ts
expect_exit 0 kollaudo push ctrf/ctrf-report.json --component kollaudo --env ci \
  --version "$VERSION" --commit "$VERSION" --branch "$BRANCH"
expect_output "Sent 4 tests (e2e) for kollaudo"
expect_output "$KOLLAUDO_URL/test-runs/"

echo "## 2b. Unit tests as JUnit XML, at build level"
(cd .. && pnpm vitest run --project cli --reporter=junit --outputFile=e2e/junit/cli.xml >/dev/null)
expect_exit 0 kollaudo push junit/cli.xml --component kollaudo --version "$VERSION" --kind unit \
  --tool vitest
expect_output "(unit) from 1 JUnit file for kollaudo"
# The real reports of six tools, matched by a pattern, make one run.
expect_exit 0 kollaudo push "../packages/cli/src/testdata/junit/*.xml" --component junit-tools \
  --env ci --version 1.0.0 --kind unit
expect_output "Sent 26 tests (unit) from 6 JUnit files for junit-tools 1.0.0 on ci: 13 passed, 8 failed, 5 skipped, 2 flaky"
expect_exit 1 kollaudo verdict --component junit-tools --env ci --version 1.0.0
expect_output "unit failed."

echo "## 3. The verdict gates on the results"
expect_exit 0 kollaudo verdict --component kollaudo --env ci --version "$VERSION"
expect_output "PASS  kollaudo"
expect_exit 2 kollaudo verdict --component kollaudo --env ci --version "$VERSION" --require e2e,ui
expect_output "Evidence is missing for ui."
expect_exit 2 kollaudo verdict --component kollaudo --env production --version "$VERSION"
expect_exit 0 kollaudo push fixtures/failed.json --component checkout --env ci --version 2.0.0
expect_exit 1 kollaudo verdict --component checkout --env ci --version 2.0.0
expect_output "e2e failed."
KOLLAUDO_TOKEN=$E2E_READ_TOKEN expect_exit 0 \
  kollaudo verdict --component kollaudo --env ci --version "$VERSION"

echo "## 4. Wrong reports and tokens are refused"
expect_exit 1 kollaudo push fixtures/invalid.json --component kollaudo --env ci --version "$VERSION"
expect_output "fixtures/invalid.json: results.tests.0.status"
KOLLAUDO_TOKEN=$E2E_READ_TOKEN expect_exit 1 \
  kollaudo push fixtures/passed.json --component kollaudo --env ci --version "$VERSION"
expect_output "403 forbidden"

echo "## 5. The other project has its own data"
KOLLAUDO_TOKEN=$OTHER_INGEST_TOKEN expect_exit 0 \
  kollaudo push fixtures/passed.json --component blog-web --env dev --version 1.0.0
KOLLAUDO_TOKEN=$OTHER_INGEST_TOKEN expect_exit 2 \
  kollaudo verdict --component kollaudo --env ci --version "$VERSION"

echo "## 6. The UI shows it all, and its tests are sent too"
pnpm exec playwright test tests/ui.spec.ts
expect_exit 0 kollaudo push ctrf/ctrf-report.json --component kollaudo --env ci \
  --version "$VERSION" --kind ui
expect_exit 0 kollaudo verdict --component kollaudo --env ci --version "$VERSION" --require e2e,ui

echo "All end-to-end checks passed."
