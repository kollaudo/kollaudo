#!/usr/bin/env bash
# Tests the Argo Rollouts recipe (docs/recipes/argo-rollouts.md) in a cluster where Kollaudo runs,
# installed by install-kollaudo.sh: the canary of a new version asks Kollaudo for the verdict in
# staging before it gets any pods, waits while evidence is missing, is aborted when the tests failed
# or Kollaudo is down, and goes on when they passed.
set -euo pipefail
cd "$(dirname "$0")/../.."

ROLLOUTS_VERSION=${ROLLOUTS_VERSION:-v1.10.0}
# The image of the example component. The gate asks about the version in the "version" label.
IMAGE=public.ecr.aws/nginx/nginx:1.26.0
NS=kollaudo-demo

admin() { kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server "$@"; }
post() {
  kubectl exec -n kollaudo deploy/kollaudo -- wget -qO- --header "Authorization: Bearer $1" \
    --header "Content-Type: application/json" --post-data "$3" "http://localhost:8080$2"
  echo
}

# Staging runs a version, and its e2e tests ran there, with one test that passed or failed.
staging() {
  post "$INGEST" /v1/deployments "{\"component\":\"web\",\"environment\":\"staging\",\"version\":\"$1\",\"tool\":\"argo-rollouts\"}"
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

rollout() { kubectl -n "$NS" get rollout web -o jsonpath="$1"; }

# Changes the version of the Rollout, which starts a canary, and prints its pod template hash.
release() {
  local before
  before=$(rollout '{.status.currentPodHash}')
  kubectl -n "$NS" patch rollout web --type merge \
    -p "{\"spec\":{\"template\":{\"metadata\":{\"labels\":{\"version\":\"$1\"}}}}}" >/dev/null
  for _ in $(seq 30); do
    [[ $(rollout '{.status.currentPodHash}') != "$before" ]] && break
    sleep 2
  done
  rollout '{.status.currentPodHash}'
}

# Waits for the analysis of a canary to reach one of the given phases, and prints its phase and
# message.
analysis() {
  local hash=$1 phases=$2 run="" phase=""
  for _ in $(seq 120); do
    run=$(kubectl -n "$NS" get analysisrun -o name | grep -- "-$hash-" | head -1 || true)
    [[ -n $run ]] && phase=$(kubectl -n "$NS" get "$run" -o jsonpath='{.status.phase}')
    grep -qwE "$phases" <<<"$phase" && break
    sleep 5
  done
  echo "${run#*/} $phase: $( [[ -n $run ]] && kubectl -n "$NS" get "$run" -o jsonpath='{.status.message}')"
  grep -qwE "$phases" <<<"$phase" || { echo "✗ the analysis of $hash is '$phase', not $phases"; exit 1; }
}

aborted() {
  for _ in $(seq 30); do
    [[ $(rollout '{.status.abort}') == true ]] && return
    sleep 2
  done
  echo "✗ the rollout should be aborted"
  exit 1
}

canary_pods() {
  kubectl -n "$NS" get rs -l "rollouts-pod-template-hash=$1" -o jsonpath='{.items[0].status.replicas}'
}

echo "## A project, and a policy: e2e tests are required in staging, on the deployed version"
project="rollouts-$(date +%s)"
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

echo "## Argo Rollouts $ROLLOUTS_VERSION"
kubectl create namespace argo-rollouts --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -n argo-rollouts --server-side --force-conflicts -f \
  "https://github.com/argoproj/argo-rollouts/releases/download/$ROLLOUTS_VERSION/install.yaml" >/dev/null
kubectl -n argo-rollouts rollout status deploy/argo-rollouts --timeout=300s

echo "## The recipe: the analysis template, the read token, and the example Rollout"
kubectl apply -f docs/recipes/argo-rollouts/kollaudo-verdict.yaml
kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl -n "$NS" create secret generic kollaudo --from-literal=token="$READ" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NS" apply --dry-run=server -f docs/recipes/argo-rollouts/rollout.yaml

echo "## A Rollout of version 1.0.0: the first one deploys without steps"
# The same gate as the example, with short canary steps.
kubectl -n "$NS" apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: web
spec:
  replicas: 2
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
  strategy:
    canary:
      steps:
        - analysis:
            templates:
              - templateName: kollaudo-verdict
                clusterScope: true
            args:
              - name: component
                value: web
              - name: environment
                value: staging
              - name: version
                valueFrom:
                  fieldRef:
                    fieldPath: spec.template.metadata.labels.version
        - setWeight: 50
        - pause: { duration: 5s }
EOF
for _ in $(seq 60); do
  [[ $(rollout '{.status.phase}') == Healthy ]] && break
  sleep 5
done
[[ $(rollout '{.status.phase}') == Healthy ]] || { echo "✗ the first Rollout should be Healthy"; exit 1; }

echo "## 1.1.0 without evidence: the canary waits, without pods"
hash=$(release 1.1.0)
analysis "$hash" Running
sleep 70
analysis "$hash" Running
[[ $(canary_pods "$hash") == 0 ]] || { echo "✗ the canary should have no pods yet"; exit 1; }

echo "## Staging runs 1.1.0, and its e2e tests fail: the rollout is aborted"
staging 1.1.0 failed
analysis "$hash" Failed
aborted

echo "## 1.2.0 passed its e2e tests in staging: the canary goes on"
staging 1.2.0 passed
hash=$(release 1.2.0)
analysis "$hash" Successful
for _ in $(seq 60); do
  [[ $(rollout '{.status.phase}') == Healthy && $(rollout '{.status.stableRS}') == "$hash" ]] && break
  sleep 5
done
[[ $(rollout '{.status.stableRS}') == "$hash" ]] || { echo "✗ 1.2.0 should be the stable version"; exit 1; }

echo "## Kollaudo is down: the canary doesn't go on without a verdict"
staging 1.3.0 passed
kubectl -n kollaudo scale deploy/kollaudo --replicas=0
kubectl -n kollaudo wait --for=delete pod -l app.kubernetes.io/name=kollaudo --timeout=120s
hash=$(release 1.3.0)
analysis "$hash" Error
aborted
kubectl -n kollaudo scale deploy/kollaudo --replicas=1
kubectl -n kollaudo rollout status deploy/kollaudo --timeout=120s
echo "✓ Argo Rollouts gave the canary pods only once Kollaudo said pass, and not while it was down"
