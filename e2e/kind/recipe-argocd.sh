#!/usr/bin/env bash
# Tests the Argo CD recipe (docs/recipes/argocd.md) in a cluster where Kollaudo runs, installed by
# install-kollaudo.sh: Argo CD syncs an example application, and Kollaudo must record the deployment.
set -euo pipefail
cd "$(dirname "$0")/../.."

ARGOCD_VERSION=${ARGOCD_VERSION:-v3.5.3}
# Argo CD's own example application, at a fixed commit. Its image is gcr.io/google-samples/gb-frontend:v5.
EXAMPLES=https://github.com/argoproj/argocd-example-apps.git
EXAMPLES_REVISION=8088f4c0d970abb09e250248cc97e35623447cb5

admin() { kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server "$@"; }
api() { kubectl exec -n kollaudo deploy/kollaudo -- wget -qO- --header "Authorization: Bearer $READ" "http://localhost:8080$1"; }

echo "## A project for the recipe"
tokens=$(admin project create "argocd-$(date +%s)")
INGEST=$(awk '$1 == "ingest" { print $2 }' <<<"$tokens")
READ=$(awk '$1 == "read" { print $2 }' <<<"$tokens")

echo "## Argo CD $ARGOCD_VERSION"
kubectl create namespace argocd --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -n argocd --server-side --force-conflicts -f \
  "https://raw.githubusercontent.com/argoproj/argo-cd/$ARGOCD_VERSION/manifests/install.yaml" >/dev/null
for workload in deploy/argocd-repo-server deploy/argocd-notifications-controller \
  statefulset/argocd-application-controller; do
  kubectl -n argocd rollout status "$workload" --timeout=300s
done

echo "## The recipe: notifications and the token"
kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=kollaudo-token="$INGEST" --dry-run=client -o yaml |
  kubectl apply --server-side --force-conflicts -f - >/dev/null
kubectl -n argocd patch configmap argocd-notifications-cm --type merge \
  --patch-file docs/recipes/argocd/argocd-notifications-cm.yaml

echo "## An application that subscribes to it"
kubectl apply -f - <<EOF
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: guestbook
  namespace: argocd
  annotations:
    notifications.argoproj.io/subscribe.on-kollaudo-deployed.kollaudo: ""
    kollaudo.io/environment: staging
spec:
  project: default
  source:
    repoURL: $EXAMPLES
    targetRevision: $EXAMPLES_REVISION
    path: guestbook
  destination:
    server: https://kubernetes.default.svc
    namespace: guestbook
  syncPolicy:
    automated: {}
    syncOptions: [CreateNamespace=true]
EOF

echo "## Kollaudo records the deployment"
for _ in $(seq 60); do
  deployments=$(api /v1/deployments)
  grep -q '"component":"guestbook"' <<<"$deployments" && break
  sleep 5
done
echo "$deployments"
python3 - "$deployments" <<'EOF'
import json, sys
items = json.loads(sys.argv[1])["items"]
assert len(items) == 1, f"expected one deployment, got {len(items)}"
d = items[0]
expected = {"component": "guestbook", "environment": "staging", "version": "v5", "tool": "argocd"}
for key, value in expected.items():
    assert d[key] == value, f"{key} is {d[key]!r}, not {value!r}"
assert d["deployedAt"] < d["createdAt"], "deployedAt should be when Argo CD finished the sync"
print("✓ Argo CD's sync is a deployment in Kollaudo:", d["component"], d["version"], "in", d["environment"])
EOF
