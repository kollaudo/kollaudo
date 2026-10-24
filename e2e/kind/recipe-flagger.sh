#!/usr/bin/env bash
# Tests the Flagger recipe (docs/recipes/flagger.md) in a cluster where Kollaudo runs, installed by
# install-kollaudo.sh: the canary of a new version asks Kollaudo for the verdict in staging before it
# gets any traffic, waits without pods while evidence is missing, is rolled back when the tests failed
# or Kollaudo is down, and is promoted when they passed. Flagger runs with the kubernetes provider, a
# blue/green deployment without a mesh: the webhooks are the same for a canary with weights.
set -euo pipefail
cd "$(dirname "$0")/../.."

FLAGGER_VERSION=${FLAGGER_VERSION:-1.45.0}
LOADTESTER_VERSION=${LOADTESTER_VERSION:-0.39.0}
# The image of the example component. The gate asks about the version in the "version" label.
IMAGE=docker.io/library/nginx:1.26.0
NS=kollaudo-demo

admin() { kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server "$@"; }
post() {
  kubectl exec -n kollaudo deploy/kollaudo -- wget -qO- --header "Authorization: Bearer $1" \
    --header "Content-Type: application/json" --post-data "$3" "http://localhost:8080$2"
  echo
}

# Staging runs a version, and its e2e tests ran there, with one test that passed or failed.
staging() {
  post "$INGEST" /v1/deployments "{\"component\":\"web\",\"environment\":\"staging\",\"version\":\"$1\",\"tool\":\"flagger\"}"
  post "$INGEST" /v1/test-runs "$(python3 - "$1" "$2" <<'EOF'
import json, sys, time
now = int(time.time() * 1000)
print(json.dumps({
    "component": "web", "version": sys.argv[1], "environment": "staging", "kind": "e2e",
    "report": {"results": {
        "tool": {"name": "playwright"},
        "summary": {"tests": 1, "start": now, "stop": now},
        "tests": [{"name": "shows the home page", "status": sys.argv[2], "duration": 1200}],
    }},
}))
EOF
)"
}

phase() { kubectl -n "$NS" get canary web -o jsonpath='{.status.phase}'; }

# Waits for the canary to reach one of the given phases.
wait_phase() {
  local phases=$1 current=""
  for _ in $(seq 60); do
    current=$(phase)
    grep -qwE "$phases" <<<"$current" && break
    sleep 5
  done
  echo "canary web: ${current:-no phase}"
  grep -qwE "$phases" <<<"$current" || { echo "✗ the canary is '$current', not $phases"; exit 1; }
}

# Changes the version of the Deployment, which starts a canary.
release() {
  kubectl -n "$NS" patch deployment web --type merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"labels\":{\"version\":\"$1\"}}}}}" >/dev/null
}

primary_version() {
  kubectl -n "$NS" get deployment web-primary -o jsonpath='{.spec.template.metadata.labels.version}'
}

canary_replicas() { kubectl -n "$NS" get deployment web -o jsonpath='{.spec.replicas}'; }

# Checks that Flagger said why it rolled back the canary.
rolled_back() {
  kubectl -n "$NS" get events --field-selector involvedObject.kind=Canary,involvedObject.name=web \
    -o jsonpath='{range .items[*]}{.message}{"\n"}{end}' | grep -- "$1" ||
    { echo "✗ Flagger should say: $1"; exit 1; }
}

echo "## A project, and a policy: e2e tests are required in staging, on the deployed version"
project="flagger-$(date +%s)"
tokens=$(admin project create "$project")
INGEST=$(awk '$1 == "ingest" { print $2 }' <<<"$tokens")
READ=$(awk '$1 == "read" { print $2 }' <<<"$tokens")
POLICY=$(admin token create "$project" --scope policy | awk '$1 == "policy" { print $2 }')
post "$POLICY" /v1/policy "$(python3 -c 'import json, sys; print(json.dumps({"source": sys.argv[1]}))' '
environments:
  staging:
    require: [e2e]
    deployed: true
')"

echo "## Flagger $FLAGGER_VERSION with the kubernetes provider"
helm repo add flagger https://flagger.app >/dev/null
helm upgrade --install flagger flagger/flagger --version "$FLAGGER_VERSION" -n flagger-system \
  --create-namespace --wait --timeout 5m --set meshProvider=kubernetes

echo "## The recipe: the read token, the script, the load tester and the example Canary"
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic kollaudo --from-literal=token="$READ" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" apply -f docs/recipes/flagger/kollaudo-verdict.yaml
helm upgrade --install flagger-loadtester flagger/loadtester --version "$LOADTESTER_VERSION" -n "$NS" \
  --wait --timeout 5m -f docs/recipes/flagger/loadtester-values.yaml
kubectl -n "$NS" apply --dry-run=server -f docs/recipes/flagger/canary.yaml

echo "## A Deployment of version 1.0.0 and its Canary: the first version is the primary, without steps"
# The same webhooks as the example, with a short analysis.
kubectl -n "$NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
        version: "1.0.0"
    spec:
      containers:
        - name: web
          image: $IMAGE
          ports:
            - containerPort: 80
---
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: web
spec:
  provider: kubernetes
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: web
  progressDeadlineSeconds: 120
  service:
    port: 80
  analysis:
    interval: 10s
    threshold: 2
    iterations: 2
    webhooks:
      - name: kollaudo-wait
        type: confirm-rollout
        url: http://flagger-loadtester.$NS/
        timeout: 30s
        metadata:
          type: bash
          cmd: bash /kollaudo/verdict.sh confirm-rollout web web staging
      - name: kollaudo-fail
        type: rollback
        url: http://flagger-loadtester.$NS/
        timeout: 30s
        metadata:
          type: bash
          cmd: bash /kollaudo/verdict.sh rollback web web staging
      - name: kollaudo-pass
        type: pre-rollout
        url: http://flagger-loadtester.$NS/
        timeout: 30s
        metadata:
          type: bash
          cmd: bash /kollaudo/verdict.sh pre-rollout web web staging
EOF
wait_phase Initialized

echo "## 1.1.0 without evidence: the canary waits, without pods"
release 1.1.0
wait_phase Waiting
sleep 40
wait_phase Waiting
[[ $(canary_replicas) == 0 ]] || { echo "✗ the canary should have no pods yet"; exit 1; }

echo "## Staging runs 1.1.0, and its e2e tests fail: the canary is rolled back"
staging 1.1.0 failed
wait_phase Failed
rolled_back "manual webhook invoked"
[[ $(primary_version) == 1.0.0 ]] || { echo "✗ 1.0.0 should still be the primary"; exit 1; }

echo "## 1.2.0 passed its e2e tests in staging: the canary is promoted"
staging 1.2.0 passed
release 1.2.0
wait_phase Succeeded
[[ $(primary_version) == 1.2.0 ]] || { echo "✗ 1.2.0 should be the primary"; exit 1; }

echo "## Kollaudo is down: the canary doesn't go on without a verdict"
staging 1.3.0 passed
kubectl -n kollaudo scale deploy/kollaudo --replicas=0
kubectl -n kollaudo wait --for=delete pod -l app.kubernetes.io/name=kollaudo --timeout=120s
release 1.3.0
wait_phase Failed
rolled_back "failed checks threshold reached"
[[ $(primary_version) == 1.2.0 ]] || { echo "✗ 1.2.0 should still be the primary"; exit 1; }
kubectl -n kollaudo scale deploy/kollaudo --replicas=1
kubectl -n kollaudo rollout status deploy/kollaudo --timeout=120s
echo "✓ Flagger promoted the canary only once Kollaudo said pass, and not while it was down"
