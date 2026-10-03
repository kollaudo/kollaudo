# Policies: the rules of your verdicts

A policy says what a verdict requires, for each environment and component: which kinds of test, and
whether tests count only for the version that was deployed. Kollaudo keeps it, so a pipeline that
asks for a verdict can make the rules stricter, never weaker
([ADR 0016](adr/0016-rules-kept-by-kollaudo.md)).

Without a policy, verdicts apply the [default rules](sending-results.md#what-the-verdict-checks-today):
the kinds that ran are judged, and nothing is required.

## A policy file

Keep it in a repository, as `kollaudo.yaml` for example, and review changes like any other code:

```yaml
# Rules for every environment that no other entry matches.
default:
  require: [e2e]

environments:
  staging:
    require: [e2e, smoke]   # kinds of test that must have passed
    deployed: true          # tests count only if they ran while the version was deployed here
    flaky: fail             # a flaky test fails its run (default: allow)
    maxAge: 7d              # runs older than 7 days don't count (m, h or d)

  "pr-*":                   # every environment whose name matches
    require: [e2e]

  production:
    require: [smoke]

# Rules for one component, which replace those of the environment, field by field.
components:
  payments:
    environments:
      staging:
        require: [e2e, smoke, pci]
```

| Field | Meaning | Default |
|---|---|---|
| `require` | kinds of test that must have a run that counts | none |
| `deployed` | a run counts only if, when it started, the latest deployment of the component in the environment was the tested version | `false` |
| `flaky` | `fail`: a flaky test fails its run. `allow`: flaky tests that passed in the end don't | `allow` |
| `maxAge` | runs received longer ago don't count, such as `30m`, `12h`, `7d` | none |
| `from` | the environment versions come from before this one, such as `staging` for `production`. Deployments without a pass there before them are marked [ungated](#deployments-that-skip-the-gate) | none |

**Which rules apply** to a component in an environment: the entry for that component and
environment, else the entry for the environment, by exact name before patterns, else `default`. A
field set in a more specific entry replaces the one of a less specific entry; fields it doesn't set
come from the less specific one.

**`deployed: true`** needs to know what was deployed when: report deployments with
`kollaudo deployed`, or with the [Argo CD recipe](recipes/argocd.md). A run that started before any
deployment Kollaudo knows of, or while another version was deployed, doesn't count, and the verdict
says why. "Started" is the start time in the report, else the time Kollaudo received it.

## Send it

Policies are sent with a token of the `policy` scope, which CI jobs that send results don't hold:
they can't change the rules their results are judged by.

Create the token once, on the server:

```bash
kollaudo-server token create shop --scope policy --name rules
```

Then check the file, which validates it and keeps nothing; push it, so that a new revision applies
from now on; and show the current revision, as it was sent:

```bash
export KOLLAUDO_TOKEN=<policy token>
kollaudo policy check kollaudo.yaml
kollaudo policy push kollaudo.yaml
kollaudo policy show
```

A good place for `policy push` is a CI job that runs when `kollaudo.yaml` changes on the main branch,
with the policy token as a secret of that job only. `policy check` works with any token of the
project, so pull requests can check the file before it's merged.

## In the verdict

Every verdict says which rules it applied:

```console
$ kollaudo verdict --component api --env staging --version 3f2a9c1
UNKNOWN  api 3f2a9c1 in staging: Evidence is missing for smoke.
Policy revision 4.

  pass     e2e    98 passed  by ci-staging  https://kollaudo.example.com/test-runs/…
  unknown  smoke  Required, but no run.
```

`GET /v1/verdict` returns them in `policy`: `name` (`project` or `default`), `revision`, and the
`require`, `deployed`, `flaky` and `maxAge` that applied, including the kinds the request added.

Verdicts are computed when they are asked: a new revision changes the verdict of versions tested
before it too.

When a version has to go through without its evidence, use an [override](overrides.md), not a
looser policy.

## Deployments that skip the gate

Kollaudo can't stop a deployment that never asks for a verdict, but it can show it
([ADR 0019](adr/0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)). Say where the versions of an
environment come from:

```yaml
environments:
  production:
    from: staging
```

Then every deployment to `production` is checked against the [log of
verdicts](sending-results.md#every-verdict-is-recorded): it is **gated** when Kollaudo gave a `pass`
for the same component and version in `staging` before it was deployed, and **ungated** otherwise,
when no gate asked, or when the answer wasn't `pass`.

```console
$ kollaudo deployed --component api --env production --version 3f2a9c1
Recorded api 3f2a9c1 running in production since 2026-10-02T09:30:00.000Z
Ungated: Kollaudo gave no pass for 3f2a9c1 in staging before it was deployed.
```

The deployment is recorded all the same: Kollaudo records what happened. It shows in `gate` of each
deployment in the API, with the pass it relied on; as `ungated` next to the deployed version in the
health matrix; and in a note of the verdict for that environment.

Each deployment is checked against the policy in force when it was deployed: adding `from` doesn't
mark older deployments. An override in `staging` counts as a pass, since the verdict was `pass`, and
the override says who let it through.
