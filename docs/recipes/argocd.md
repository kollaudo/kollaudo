# Argo CD: tell Kollaudo what runs where

Each time Argo CD finishes syncing an application and the application is healthy, an Argo CD
notification tells Kollaudo which version now runs in which environment. Kollaudo then shows it in
the health matrix next to what was tested, and the verdict says when the tests judged another
version ([sending test results](../sending-results.md#tell-kollaudo-what-runs-where)).

Nothing changes in how Argo CD deploys: the recipe only adds a notification.

> Deployments come with Kollaudo 0.2.0.

The recipe is tested on every change, with Argo CD in a kind cluster
([`e2e/kind/recipe-argocd.sh`](../../e2e/kind/recipe-argocd.sh)).

## 1. The token

Create a Secret with an ingest token of your Kollaudo project, in the namespace of Argo CD:

```bash
kubectl -n argocd create secret generic argocd-notifications-secret \
  --from-literal=kollaudo-token=<ingest token>
```

If the Secret already exists, add the `kollaudo-token` key to it.

## 2. The notification

[`argocd/argocd-notifications-cm.yaml`](argocd/argocd-notifications-cm.yaml) defines:

- a `kollaudo` webhook, which sends the token as `Authorization: Bearer $kollaudo-token`. Set its
  `url` to the address where Argo CD reaches Kollaudo;
- an `on-kollaudo-deployed` trigger, once per synced revision, when the sync succeeded and the
  application is healthy;
- a `kollaudo-deployed` template, which posts the deployment to `/v1/deployments`.

Merge it into the `argocd-notifications-cm` ConfigMap:

```bash
kubectl -n argocd patch configmap argocd-notifications-cm --type merge \
  --patch-file argocd-notifications-cm.yaml
```

If you manage Argo CD with Helm, put the same keys under `notifications.notifiers`,
`notifications.triggers` and `notifications.templates` of the `argo-cd` chart's values.

## 3. Subscribe the applications

Annotate each Application that Kollaudo should know about
([`argocd/application-annotations.yaml`](argocd/application-annotations.yaml)):

```yaml
metadata:
  annotations:
    notifications.argoproj.io/subscribe.on-kollaudo-deployed.kollaudo: ""
    kollaudo.io/component: api           # default: the name of the Application
    kollaudo.io/environment: staging     # default: the destination namespace
    kollaudo.io/image: ghcr.io/example/api   # default: the first image of the Application
```

| Kollaudo | From |
|---|---|
| component | `kollaudo.io/component`, or the name of the Application |
| environment | `kollaudo.io/environment`, or the destination namespace |
| version | the tag of the image named by `kollaudo.io/image`, or of the first image. Without a tag, the synced Git revision |
| digest | the digest of that image, when it's deployed by digest |
| deployed at | when Argo CD finished the sync |

The version must match the one your CI sends with `kollaudo push`, so that Kollaudo can tell
whether the deployed version was tested. Tag images with the version, as most CI pipelines and
Kargo do, and send that tag as `--version`.

With an ApplicationSet, put the annotations in its template, for example with the environment from a
generator parameter: `kollaudo.io/environment: "{{.environment}}"`.

## Check it

After the next sync, the deployment shows up in Kollaudo:

```bash
curl -H "Authorization: Bearer <read token>" "$KOLLAUDO_URL/v1/deployments?component=api"
```

If nothing arrives, the logs of `argocd-notifications-controller` say whether the trigger fired
and what Kollaudo answered. A `409` means the same version was already sent with other metadata,
such as another image digest.
