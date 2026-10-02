# Policies: the rules of your verdicts

A policy says what a verdict requires, for each environment and component: which kinds of test, and
whether tests count only for the version that was deployed. Kollaudo keeps it, so a pipeline that
asks for a verdict can make the rules stricter, never weaker
([ADR 0016](adr/0016-rules-kept-by-kollaudo.md)).

> Policies come with the next release, 0.2.0.

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
| `from` | the environment versions come from before this one. Kollaudo doesn't use it yet | none |

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

```bash
kollaudo-server token create shop --scope policy --name rules   # once, on the server

export KOLLAUDO_TOKEN=<policy token>
kollaudo policy check kollaudo.yaml   # validate it, keep nothing
kollaudo policy push kollaudo.yaml    # a new revision applies from now on
kollaudo policy show                  # the current revision, as it was sent
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
