# Flagger: a canary goes on only on `pass`

When a Deployment gets a new version, such as in `production`, Flagger's webhooks ask Kollaudo for the
verdict of that version in the environment it comes from, such as `staging`. The new version gets
traffic only when the verdict is `pass`:

| Verdict | The canary |
|---|---|
| `pass` | goes on with the analysis, and gets its first step of traffic |
| `fail` | is rolled back before it gets any traffic. It gets pods for one interval first: see [below](#why-fail-gets-pods-for-one-interval) |
| `unknown` | waits, without pods: the webhook asks again every interval, with no time limit, until the evidence arrives, an override is given or the Deployment is reverted |
| no answer | is rolled back after `analysis.threshold` failed checks. Kollaudo out of reach, or a wrong token, never let a version through ([ADR 0019](../adr/0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)) |

The rules are those of your [policy](../policies.md), kept by Kollaudo: Flagger only asks. An urgent
fix goes through with an [override](../overrides.md), not by removing the webhooks.

The recipe is tested on every change, with Flagger in a kind cluster
([`e2e/kind/recipe-flagger.sh`](../../e2e/kind/recipe-flagger.sh)): a canary that waits without
evidence and has no pods meanwhile, is rolled back when the e2e tests failed, is promoted when they
passed, and is rolled back while Kollaudo is down. CI runs Flagger with the `kubernetes` provider, a
blue/green deployment without a mesh: the webhooks are the same for a canary with weights, as in the
example below.

## How it works

Flagger's webhooks answer with an HTTP status, while `GET /v1/verdict` answers 200 with the outcome in
its body. So the webhooks call Flagger's [load tester](https://docs.flagger.app/usage/webhooks),
which runs a `bash` command and answers 200 only when it exits 0. The command,
[`flagger/kollaudo-verdict.yaml`](flagger/kollaudo-verdict.yaml), reads the `version` label of the
target Deployment, asks Kollaudo for the verdict, and exits according to the webhook:

| Webhook | Succeeds when the verdict is | So that |
|---|---|---|
| `confirm-rollout` | anything but `unknown` | without evidence, the canary stays in `Waiting`, without pods |
| `rollback` | `fail` | the canary is rolled back before it gets traffic |
| `pre-rollout` | `pass` | the canary gets traffic only on `pass`. Each other answer is a failed check |

## 1. The token and the script

In the namespace of the gated Deployments, create a Secret with a `read` token of your Kollaudo
project, and install the script as a ConfigMap:

```bash
kubectl -n <namespace> create secret generic kollaudo --from-literal=token=<read token>
kubectl -n <namespace> apply -f kollaudo-verdict.yaml
```

A `read` token can ask for verdicts and nothing else: the gate can't send evidence or override
itself ([ADR 0017](../adr/0017-trust-in-evidence.md)). Give it a name, so that the
[log of verdicts](../sending-results.md#every-verdict-is-recorded) says which gate asked:

```bash
kubectl exec -n kollaudo deploy/kollaudo -- kollaudo-server token create <project> --scope read --name flagger
```

## 2. The load tester

Install Flagger's load tester in the same namespace, with
[`flagger/loadtester-values.yaml`](flagger/loadtester-values.yaml):

```bash
helm repo add flagger https://flagger.app
helm upgrade --install flagger-loadtester flagger/loadtester -n <namespace> -f loadtester-values.yaml
```

The values give the load tester the token and the address of Kollaudo, as environment variables,
and mount the script at `/kollaudo/verdict.sh`. Set `KOLLAUDO_URL` to the address where the load
tester reaches Kollaudo.

The script reads the `version` label with `kubectl`, so the service account of the load tester needs
to get Deployments in its namespace. The values create it, with a Role for that and nothing else:

```yaml
rbac:
  create: true
  rules:
    - apiGroups: ["apps"]
      resources: ["deployments"]
      verbs: ["get"]
```

If you already run a load tester for your load tests, add these values to it instead.

## 3. The gated Canary

Add the three webhooks to the analysis of the Canary, before your metrics and load tests
([`flagger/canary.yaml`](flagger/canary.yaml)). Each calls the load tester of the Canary's
namespace, here `production`:

```yaml
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  analysis:
    interval: 1m
    threshold: 5
    maxWeight: 50
    stepWeight: 10
    webhooks:
      - name: kollaudo-wait
        type: confirm-rollout
        url: http://flagger-loadtester.production/
        timeout: 30s
        metadata:
          type: bash
          cmd: bash /kollaudo/verdict.sh confirm-rollout api api staging
      - name: kollaudo-fail
        type: rollback
        url: http://flagger-loadtester.production/
        timeout: 30s
        metadata:
          type: bash
          cmd: bash /kollaudo/verdict.sh rollback api api staging
      - name: kollaudo-pass
        type: pre-rollout
        url: http://flagger-loadtester.production/
        timeout: 30s
        metadata:
          type: bash
          cmd: bash /kollaudo/verdict.sh pre-rollout api api staging
```

The script takes the webhook, then:

| Argument | |
|---|---|
| deployment | the target Deployment, `api` here. The script reads its `version` label |
| component | the component, as your CI sends it with `kollaudo push --component` |
| environment | where the version was tested, such as staging |

Set the `version` label of the pod template with the image tag, so that the gate asks about the
version that is rolled out:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
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
```

The version must match the one your CI sends with `kollaudo push --version`. Component, environment
and version go into the URL as they are, so keep them to letters, digits, `.`, `-` and `_`. A
Deployment without the label gets no verdict, and is rolled back like when Kollaudo doesn't answer.

The first version of a Deployment becomes the primary when Flagger initializes the Canary, without
the webhooks: Flagger runs the analysis only when the Deployment changes.

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

Change the version of the Deployment. While evidence is missing, the Canary is `Waiting` and the
Deployment has no pods:

```bash
kubectl get canary api
```

The logs of the load tester show each answer, such as
`Kollaudo: api 1.4.0 in staging is unknown`. When the canary is rolled back, its events say why:
`manual webhook invoked` on `fail`, `failed checks threshold reached` when Kollaudo didn't answer.

```bash
kubectl describe canary api
```

The same verdict, with each reason, is one command away:

```bash
kollaudo verdict --component api --env staging --version 1.4.0
```

## Why fail gets pods for one interval

Flagger runs the `rollback` webhook only once the canary is progressing, and it starts progressing by
scaling the new version up. On `fail`, the `confirm-rollout` webhook lets the canary through, so the
new version gets pods, without traffic, until the next interval, when the `rollback` webhook rolls it
back. Argo Rollouts aborts before any pod starts: Flagger can't.

A version that does something when it starts, such as a database migration, a message sent or a job
scheduled, does it during that interval. Keep such work out of the start of the Deployment, for
example in a step of your pipeline that runs after the gate, or gate it with a pipeline step instead
of Flagger.

## Why unknown waits, and doesn't roll back

Without evidence, the `confirm-rollout` webhook holds the canary in `Waiting`: the new version still
has no pods, and the primary keeps the traffic. Flagger asks again every interval, with no time limit,
so nothing goes on without a verdict, as ADR 0019 asks. To get out of it:

- send the evidence: at the next interval, the verdict is `pass` or `fail`, and the canary goes on or
  is rolled back;
- when the version has to go out without it, give an [override](../overrides.md) in Kollaudo: the
  verdict is `pass`, and the override is recorded with its reason;
- revert the Deployment to the version that runs.

Don't remove the webhooks, or use `skipAnalysis`, to let a version through: it skips the gate, and
nothing says why.

No answer is different: the `confirm-rollout` webhook lets the canary through, so that the
`pre-rollout` webhook counts each error as a failed check, and Flagger rolls the canary back after
`analysis.threshold` of them. Like the [Argo Rollouts recipe](argo-rollouts.md), a 4xx, such as a
wrong token, counts as an error, not as `fail`.
