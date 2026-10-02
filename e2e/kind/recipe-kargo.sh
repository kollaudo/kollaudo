#!/usr/bin/env bash
# Tests the Kargo recipe (docs/recipes/kargo.md) in a cluster where Kollaudo runs, installed by
# install-kollaudo.sh: a promotion to production asks Kollaudo for the verdict in staging, waits while
# evidence is missing, stops when the tests failed, and goes ahead when they passed.
set -euo pipefail
cd "$(dirname "$0")/../.."

KARGO_VERSION=${KARGO_VERSION:-1.11.6}
CERT_MANAGER_VERSION=${CERT_MANAGER_VERSION:-1.19.3}
# The image of the example component. Its tag is the version, as CI would send it.
IMAGE=public.ecr.aws/nginx/nginx
VERSION=1.26.0
NS=kollaudo-demo

admin() { kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server "$@"; }
post() {
  kubectl exec -n kollaudo deploy/kollaudo -- wget -qO- --header "Authorization: Bearer $1" \
    --header "Content-Type: application/json" --post-data "$3" "http://localhost:8080$2"
  echo
}

# A test run of the e2e tests of the version in staging, with one test that passed or failed.
e2e() {
  python3 - "$VERSION" "$1" <<'EOF'
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
}

# Waits for a promotion to reach one of the given phases, and prints its phase and message.
promotion() {
  local name=$1 phases=$2 phase=""
  for _ in $(seq 90); do
    phase=$(kubectl -n "$NS" get promotion "$name" -o jsonpath='{.status.phase}' 2>/dev/null || true)
    grep -qwE "$phases" <<<"$phase" && break
    sleep 5
  done
  echo "$phase: $(kubectl -n "$NS" get promotion "$name" -o jsonpath='{.status.message}')"
  grep -qwE "$phases" <<<"$phase" || { echo "✗ $name is $phase, not $phases"; exit 1; }
}

# Promotes the Freight to a Stage, and prints the name Kargo gives to the Promotion.
promote() {
  kubectl create -o jsonpath='{.metadata.name}' -f - <<EOF
apiVersion: kargo.akuity.io/v1alpha1
kind: Promotion
metadata:
  name: $1
  namespace: $NS
spec:
  stage: $1
  freight: $FREIGHT
EOF
}

echo "## A project, and a policy: e2e tests are required in staging, on the deployed version"
project="kargo-$(date +%s)"
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

echo "## cert-manager $CERT_MANAGER_VERSION and Kargo $KARGO_VERSION"
helm upgrade --install cert-manager cert-manager --repo https://charts.jetstack.io \
  --version "$CERT_MANAGER_VERSION" -n cert-manager --create-namespace --set crds.enabled=true \
  --wait --timeout 5m >/dev/null
helm upgrade --install kargo oci://ghcr.io/akuity/kargo-charts/kargo --version "$KARGO_VERSION" \
  -n kargo --create-namespace --wait --timeout 8m \
  --set api.adminAccount.enabled=false \
  --set api.rollouts.integrationEnabled=false \
  --set controller.rollouts.integrationEnabled=false \
  --set controller.argocd.integrationEnabled=false >/dev/null

echo "## The recipe: the promotion task, and the read token"
kubectl apply -f docs/recipes/kargo/kollaudo-verdict.yaml
kubectl apply -f - <<EOF
apiVersion: kargo.akuity.io/v1alpha1
kind: Project
metadata:
  name: $NS
EOF
kubectl wait --for=jsonpath='{.status.phase}'=Active "namespace/$NS" --timeout=60s
kubectl -n "$NS" create secret generic kollaudo --from-literal=token="$READ" \
  --dry-run=client -o yaml | kubectl label --local -f - kargo.akuity.io/cred-type=generic -o yaml |
  kubectl apply -f -

echo "## A pipeline: staging, then production, gated by Kollaudo"
# Staging and production don't deploy anything here: the steps that would, such as argocd-update,
# don't matter for the gate.
kubectl apply -f - <<EOF
apiVersion: kargo.akuity.io/v1alpha1
kind: Warehouse
metadata:
  name: web
  namespace: $NS
spec:
  subscriptions:
    - image:
        repoURL: $IMAGE
        constraint: "$VERSION"
        discoveryLimit: 1
---
apiVersion: kargo.akuity.io/v1alpha1
kind: Stage
metadata:
  name: staging
  namespace: $NS
spec:
  requestedFreight:
    - origin: { kind: Warehouse, name: web }
      sources: { direct: true }
  promotionTemplate:
    spec:
      steps:
        - uses: compose-output
          config:
            image: \${{ imageFrom('$IMAGE').Tag }}
---
apiVersion: kargo.akuity.io/v1alpha1
kind: Stage
metadata:
  name: production
  namespace: $NS
spec:
  requestedFreight:
    - origin: { kind: Warehouse, name: web }
      sources: { stages: [staging] }
  promotionTemplate:
    spec:
      steps:
        - task: { name: kollaudo-verdict, kind: ClusterPromotionTask }
          vars:
            - name: component
              value: web
            - name: environment
              value: staging
            - name: version
              value: \${{ imageFrom('$IMAGE').Tag }}
        - uses: compose-output
          config:
            image: \${{ imageFrom('$IMAGE').Tag }}
EOF

FREIGHT=""
for _ in $(seq 60); do
  FREIGHT=$(kubectl -n "$NS" get freight -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
  [[ -n $FREIGHT ]] && break
  sleep 5
done
[[ -n $FREIGHT ]] || { echo "✗ the Warehouse found no Freight"; exit 1; }
echo "Freight $FREIGHT: $IMAGE:$VERSION"

promotion "$(promote staging)" Succeeded
for _ in $(seq 60); do
  kubectl -n "$NS" get freight "$FREIGHT" -o jsonpath='{.status.verifiedIn}' | grep -q staging && break
  sleep 5
done
kubectl -n "$NS" get freight "$FREIGHT" -o jsonpath='{.status.verifiedIn}' | grep -q staging ||
  { echo "✗ the Freight should be verified in staging"; exit 1; }

echo "## No evidence yet: the promotion to production waits"
first=$(promote production)
sleep 30
promotion "$first" Running

echo "## Staging runs the version, and its e2e tests fail: the promotion stops"
post "$INGEST" /v1/deployments "{\"component\":\"web\",\"environment\":\"staging\",\"version\":\"$VERSION\",\"tool\":\"kargo\"}"
post "$INGEST" /v1/test-runs "$(e2e failed)"
promotion "$first" 'Failed|Errored'
kubectl -n "$NS" get promotion "$first" -o jsonpath='{.status.message}' | grep -q "e2e" ||
  { echo "✗ the promotion should say that e2e failed"; exit 1; }

echo "## The fix is tested and the e2e tests pass: the promotion goes ahead"
post "$INGEST" /v1/test-runs "$(e2e passed)"
promotion "$(promote production)" Succeeded

echo "## Kollaudo is down: the promotion doesn't go ahead without a verdict"
kubectl -n kollaudo scale deploy/kollaudo --replicas=0
kubectl -n kollaudo wait --for=delete pod -l app.kubernetes.io/name=kollaudo --timeout=120s
promotion "$(promote production)" 'Failed|Errored'
kubectl -n kollaudo scale deploy/kollaudo --replicas=1
kubectl -n kollaudo rollout status deploy/kollaudo --timeout=120s
echo "✓ Kargo promoted $IMAGE:$VERSION to production only once Kollaudo said pass, and not while it was down"
