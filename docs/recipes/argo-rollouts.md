# Argo Rollouts: a canary goes on only on `pass`

When a Rollout gets a new version, such as in `production`, the first step of its canary asks Kollaudo
for the verdict of that version in the environment it comes from, such as `staging`. The new version
gets pods, and traffic, only when the verdict is `pass`:

| Verdict | The rollout |
|---|---|
| `pass` | goes on with the next steps |
| `fail` | is aborted at once: the stable version keeps all the traffic |
| `unknown` | waits: the analysis asks again every minute. After an hour, it is inconclusive, and the rollout stays paused until someone aborts it |
| no answer | is aborted after five errors in a row. Kollaudo out of reach, or a wrong token, never let a version through ([ADR 0019](../adr/0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)) |

The rules are those of your [policy](../policies.md), kept by Kollaudo: the Rollout only asks. An
urgent fix goes through with an [override](../overrides.md), not by removing the step.

The recipe is tested on every change, with Argo Rollouts in a kind cluster
([`e2e/kind/recipe-argo-rollouts.sh`](../../e2e/kind/recipe-argo-rollouts.sh)): a canary that waits
without evidence and has no pods meanwhile, is aborted when the e2e tests failed, goes on when they
passed, and is aborted while Kollaudo is down.

## 1. The analysis template

[`argo-rollouts/kollaudo-verdict.yaml`](argo-rollouts/kollaudo-verdict.yaml) is a
`ClusterAnalysisTemplate` with one [`web`](https://argo-rollouts.readthedocs.io/en/stable/analysis/web/)
metric, which calls `GET /v1/verdict` and reads `outcome` from the answer. Install it once for all
namespaces:

```bash
kubectl apply -f kollaudo-verdict.yaml
```

Set the default of `kollaudo-url` to the address where the Argo Rollouts controller reaches Kollaudo,
or pass it in each Rollout. To change how long a rollout waits for missing evidence, edit `count`
and `inconclusiveLimit`, the number of tries one minute apart.

The template needs Argo Rollouts 1.8 or later, for `consecutiveSuccessLimit`: without it, the
analysis would go on asking for an hour after a `pass`.

## 2. The token

In the namespace of each gated Rollout, create a Secret with a `read` token of your Kollaudo project.
An analysis can only read Secrets of its own namespace:

```bash
kubectl -n <namespace> create secret generic kollaudo --from-literal=token=<read token>
```

A `read` token can ask for verdicts and nothing else: the gate can't send evidence or override
itself ([ADR 0017](../adr/0017-trust-in-evidence.md)). Give it a name, so that the
[log of verdicts](../sending-results.md#every-verdict-is-recorded) says which gate asked:

```bash
kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server token create <project> --scope read --name argo-rollouts
```

## 3. The gated Rollout

Put the analysis first in the steps of the canary, before any `setWeight`
([`argo-rollouts/rollout.yaml`](argo-rollouts/rollout.yaml)):

```yaml
spec:
  template:
    metadata:
      labels:
        app: api
        version: "1.4.0"
    spec:
      containers:
        - name: api
          image: ghcr.io/example/api:1.4.0
  strategy:
    canary:
      steps:
        - analysis:
            templates:
              - templateName: kollaudo-verdict
                clusterScope: true
            args:
              - name: component
                value: api
              - name: environment
                value: staging
              - name: version
                valueFrom:
                  fieldRef:
                    fieldPath: spec.template.metadata.labels.version
        - setWeight: 25
        # Then your canary steps.
```

| Argument | |
|---|---|
| `component` | the component, as your CI sends it with `kollaudo push --component` |
| `environment` | where the version was tested, such as staging |
| `version` | the `version` label of the pod template. Set it with the image tag, so that the gate asks about the version that is rolled out |

The version must match the one your CI sends with `kollaudo push --version`. The `version` label is
read with a plain field path: Argo Rollouts doesn't read labels with dots or slashes in their name,
such as `app.kubernetes.io/version`, from the pod template. Component, environment and version go
into the URL as they are, so keep them to letters, digits, `.`, `-` and `_`.

The first version of a Rollout is deployed without steps, so without the gate: Argo Rollouts runs
the steps only when the Rollout changes.

With a blue-green Rollout, use the same template as the pre-promotion analysis: the new version runs
as the preview, and gets the traffic only on `pass`.

```yaml
strategy:
  blueGreen:
    activeService: api
    previewService: api-preview
    prePromotionAnalysis:
      templates:
        - templateName: kollaudo-verdict
          clusterScope: true
      args: # the same as for the canary
```

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

Change the version of the Rollout. While evidence is missing, the analysis is `Running` and the
canary has no pods. With the [kubectl plugin](https://argo-rollouts.readthedocs.io/en/stable/installation/#kubectl-plugin-installation):

```bash
kubectl argo rollouts get rollout api
```

When the rollout is aborted, the AnalysisRun says why:

```text
Metric "verdict" assessed Failed due to failed (1) > failureLimit (0)
```

The same verdict, with each reason, is one command away:

```bash
kollaudo verdict --component api --env staging --version 1.4.0
```

## Why unknown pauses, and doesn't abort

An analysis that never gets `pass` or `fail` ends as *inconclusive*, and Argo Rollouts pauses the
rollout there: the new version still has no pods, and the stable one keeps the traffic. Nothing goes
on without a verdict, as ADR 0019 asks, and a person decides what to do:

- when the evidence has arrived, abort and retry, so that a new analysis asks again:
  `kubectl argo rollouts abort api`, then `kubectl argo rollouts retry rollout api`;
- when the version has to go out without it, give an [override](../overrides.md) in Kollaudo, then
  abort and retry: the override is recorded with its reason.

Don't promote an inconclusive rollout with `kubectl argo rollouts promote`: it skips the gate, and
nothing says why.

An error, such as Kollaudo out of reach, is different: Argo Rollouts aborts the rollout after
`consecutiveErrorLimit` errors in a row. Unlike the [Kargo recipe](kargo.md), a 4xx, such as a wrong
token, isn't failed at once: the web metric counts every non-2xx answer as an error.
