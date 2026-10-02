# Kargo: promote only what Kollaudo passed

Before Kargo promotes Freight to a Stage, such as `production`, the first step of the promotion asks
Kollaudo for the verdict of its version in the Stage it comes from, such as `staging`. The promotion
goes on only when the verdict is `pass`:

| Verdict | The promotion |
|---|---|
| `pass` | goes on with the next steps |
| `fail` | stops at once, with Kollaudo's message, such as `e2e failed.` |
| `unknown` | waits: the step asks again every minute, until the evidence arrives or an hour has passed |
| no answer | stops. Kollaudo out of reach, or a wrong token, never let a version through ([ADR 0019](../adr/0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)) |

The rules are those of your [policy](../policies.md), kept by Kollaudo: the Stage only asks. An urgent
fix goes through with an [override](../overrides.md), not by removing the step.

The recipe is tested on every change, with Kargo in a kind cluster
([`e2e/kind/recipe-kargo.sh`](../../e2e/kind/recipe-kargo.sh)): a promotion to production that waits
without evidence, stops when the e2e tests failed, goes on when they passed, and stops while
Kollaudo is down.

## 1. The promotion task

[`kargo/kollaudo-verdict.yaml`](kargo/kollaudo-verdict.yaml) is a `ClusterPromotionTask` with one
[`http`](https://docs.kargo.io/user-guide/reference-docs/promotion-steps/http) step, which calls
`GET /v1/verdict`. Install it once for all projects:

```bash
kubectl apply -f kollaudo-verdict.yaml
```

Set the default of `kollaudoURL` to the address where Kargo's controller reaches Kollaudo, or set it
in each Stage. To change how long a promotion waits for missing evidence, edit `retry.timeout`.

## 2. The token

In the namespace of each Kargo project, create a Secret with a `read` token of your Kollaudo project,
labeled so that promotions can read it:

```bash
kubectl -n <kargo project> create secret generic kollaudo --from-literal=token=<read token>
kubectl -n <kargo project> label secret kollaudo kargo.akuity.io/cred-type=generic
```

A `read` token can ask for verdicts and nothing else: the gate can't send evidence or override
itself ([ADR 0017](../adr/0017-trust-in-evidence.md)).

## 3. The gated Stage

Put the task first in the steps of the Stage, before the steps that deploy
([`kargo/stage.yaml`](kargo/stage.yaml)):

```yaml
spec:
  requestedFreight:
    - origin: { kind: Warehouse, name: api }
      sources: { stages: [staging] }
  promotionTemplate:
    spec:
      steps:
        - task: { name: kollaudo-verdict, kind: ClusterPromotionTask }
          vars:
            - name: component
              value: api
            - name: environment
              value: staging
            - name: version
              value: ${{ imageFrom('ghcr.io/example/api').Tag }}
        # Then the steps that deploy, such as git-clone, kustomize-set-image and argocd-update.
```

| Variable | |
|---|---|
| `component` | the component, as your CI sends it with `kollaudo push --component` |
| `environment` | where the version was tested: the Stage the Freight comes from |
| `version` | the tag of the component's image in the Freight. A Freight can hold several images and charts: use the one of the component |

The version must match the one your CI sends with `kollaudo push --version`: tag images with the
version, and send that tag.

## 4. The policy

The verdict follows the policy of your Kollaudo project. For example, to require e2e tests in staging,
on the version that runs there:

```yaml
environments:
  staging:
    require: [e2e]
    deployed: true
```

```bash
kollaudo policy push kollaudo-policy.yaml
```

With `deployed: true`, Kollaudo needs to know what runs in staging: the [Argo CD
recipe](argocd.md) tells it after each sync, or a pipeline step runs `kollaudo deployed`.

## Check it

Promote Freight to the gated Stage. While evidence is missing, the promotion is `Running`, and the
step asks again every minute. When it stops, its message says why:

```text
step "task-1::verdict": HTTP (200) response met failure criteria: "e2e failed."
```

The same verdict, with each reason, is one command away:

```bash
kollaudo verdict --component api --env staging --version 1.4.0
```

## Why a promotion step, not a verification

Kargo can also verify a Stage after a promotion, with an Argo Rollouts `AnalysisTemplate`. As a gate,
a promotion step fits better:

- it runs **before** anything is deployed to the gated Stage, so a version that didn't pass never
  reaches it;
- it **waits** for evidence that hasn't arrived yet, such as e2e tests still running in staging,
  where an analysis would fail at once;
- it needs nothing but Kargo: no Argo Rollouts, no image to run.

If you already verify `staging` with an analysis, keep it: a verification that runs your tests and
sends them with `kollaudo push` gives Kollaudo the evidence this gate asks about.
