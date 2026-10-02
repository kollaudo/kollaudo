# Kollaudo Helm chart

Installs [Kollaudo](https://github.com/kollaudo/kollaudo) on Kubernetes: the API and the web UI, in
one Deployment. Kollaudo needs a PostgreSQL database, which the chart doesn't install: most
clusters run databases with an operator, such as [CloudNativePG](https://cloudnative-pg.io).

## Install

1. A PostgreSQL database, and a Secret with its URI. With CloudNativePG:

   ```yaml
   apiVersion: postgresql.cnpg.io/v1
   kind: Cluster
   metadata:
     name: kollaudo-db
     namespace: kollaudo
   spec:
     instances: 1
     storage:
       size: 1Gi
     bootstrap:
       initdb:
         database: kollaudo
         owner: kollaudo
   ```

   CloudNativePG creates the Secret `kollaudo-db-app`, whose `uri` key is what Kollaudo needs. With
   another database, create a Secret with a key `uri` set to
   `postgresql://user:password@host:5432/database`.

2. Kollaudo:

   ```bash
   helm install kollaudo oci://ghcr.io/kollaudo/charts/kollaudo -n kollaudo \
     --set database.existingSecret=kollaudo-db-app
   ```

3. A project, which prints its ingest and read tokens:

   ```bash
   kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server project create <name>
   ```

Migrations run when Kollaudo starts. Several replicas can start together: they take turns.

Each pod is checked twice. `/healthz` says whether the process answers: if it stops, Kubernetes
restarts the pod. `/readyz` also asks the database: while it doesn't answer, the pod gets no traffic,
but isn't restarted, since restarting wouldn't bring the database back. With `replicaCount` above
1, a gate always finds a pod that can answer while one restarts.

## Values

| Value | Default | |
|---|---|---|
| `database.existingSecret` | | **Required.** Secret with the URI of the database |
| `database.secretKey` | `uri` | Key of the URI in the Secret |
| `image.repository` | `ghcr.io/kollaudo/kollaudo` | |
| `image.tag` | the chart's `appVersion` | |
| `replicaCount` | `1` | |
| `service.type`, `service.port` | `ClusterIP`, `8080` | |
| `ingress.enabled` | `false` | With `ingress.className`, `ingress.hosts` and `ingress.tls`, as usual |
| `resources` | 50m CPU and 128Mi requested, 512Mi limit | |
| `extraEnv` | `[]` | More environment variables for the container |
| `podSecurityContext`, `securityContext` | non-root, read-only root filesystem, no capabilities | |
| `nodeSelector`, `tolerations`, `affinity`, `podAnnotations`, `podLabels`, `imagePullSecrets` | | As usual |

See [`values.yaml`](values.yaml) for all of them.

## Tested

Every change to the chart is installed in a kind cluster, with PostgreSQL from CloudNativePG and
three replicas, and the end-to-end test of Kollaudo runs against it
([workflow](../../.github/workflows/helm.yml)).
