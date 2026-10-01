#!/usr/bin/env bash
# Installs Kollaudo in the current Kubernetes cluster, such as a kind cluster, with the Helm chart of
# this repository and PostgreSQL from CloudNativePG. Used by the workflows that test the chart and
# the recipes.
#
#   e2e/kind/install-kollaudo.sh <image> [replicas]
#
# The image must already be in the cluster, for example with "kind load docker-image".
set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE=${1:?Give the image to install, such as kollaudo:ci}
REPLICAS=${2:-1}
CNPG_VERSION=${CNPG_VERSION:-1.30.1}

echo "## CloudNativePG $CNPG_VERSION and a PostgreSQL cluster"
kubectl apply --server-side -f \
  "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-${CNPG_VERSION%.*}/releases/cnpg-$CNPG_VERSION.yaml" \
  >/dev/null
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager --timeout=180s
kubectl create namespace kollaudo --dry-run=client -o yaml | kubectl apply -f - >/dev/null
kubectl apply -n kollaudo -f - <<'EOF'
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: kollaudo-db
spec:
  instances: 1
  storage:
    size: 1Gi
  bootstrap:
    initdb:
      database: kollaudo
      owner: kollaudo
EOF
kubectl -n kollaudo wait cluster/kollaudo-db --for=condition=Ready --timeout=300s

echo "## Kollaudo ($IMAGE, $REPLICAS replicas)"
helm upgrade --install kollaudo charts/kollaudo -n kollaudo --wait --timeout 5m \
  --set database.existingSecret=kollaudo-db-app \
  --set image.repository="${IMAGE%:*}" --set image.tag="${IMAGE##*:}" --set image.pullPolicy=Never \
  --set replicaCount="$REPLICAS"
