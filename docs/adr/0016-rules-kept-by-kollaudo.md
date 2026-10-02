# 16. Rules are kept by Kollaudo, and a request can't relax them

- Status: accepted
- Date: 2026-10-02

## Context

[0014](0014-policy.md) decided that policies are code, kept and versioned by Kollaudo, and planned
them for later. Until they exist, the gate that asks for a verdict also says which tests it needs,
with `--require`. The rules of the gate then live in the pipeline: a pipeline that loses its e2e step
can lose `e2e` from its `--require` just as easily, and the verdict follows. "Missing evidence never
passes" only holds for the evidence the pipeline still asks for.

There is a second gap. Test results name the version they tested, but nothing checks that this
version was the one running in the environment when the tests ran. A report sent with the wrong
version, or tests run against an environment that still had the previous version, count as evidence
for a version that was never tested.

## Decision

A **policy** is a YAML file, kept in a repository and sent to Kollaudo:

```yaml
environments:
  staging:
    require: [e2e, smoke]   # kinds of test that must have passed
    deployed: true          # tests count only if they ran while the version was deployed here
    flaky: allow            # or fail: a flaky test fails its run
    maxAge: 7d              # older runs don't count
  "pr-*":                   # environments that match a pattern
    require: [e2e]
  production:
    from: staging           # where versions come from: see 0019
    require: [smoke]
components:
  payments:
    environments:
      staging:
        require: [e2e, smoke, pci]
```

- `kollaudo policy push kollaudo.yaml` sends it, with a token of the new `policy` scope. CI jobs
  that send results hold `ingest` tokens, so they can't change the rules their results are judged by
  ([0007](0007-scoped-api-tokens.md)). Kollaudo refuses an invalid file, and
  `kollaudo policy check` validates it without sending it.
- Every push is a new **revision**, numbered and kept with who sent it. The verdict names the
  revision it applied.
- **Which rules apply** to a component in an environment: the entry for the component and the
  environment, else the entry for the environment, matched by exact name before patterns, else
  `default`. Within an entry, each field set replaces the one of the less specific entry.
- **Without a policy**, or for an environment it doesn't match, the default rules of 0014 apply, as
  today: the kinds that ran are judged, and nothing is required.
- **A request can only tighten the policy.** `--require` adds kinds; it can never remove one, and no
  other parameter of the request changes a rule.
- **`deployed: true`** needs deployments ([0004](0004-own-internal-model.md)): a test run counts only
  if, when it ran, the latest deployment of the component in the environment was the tested version.
  Runs that don't qualify count as missing, so the verdict is `unknown`, and its reasons say why: the
  evidence may be true, but it isn't about this version.
- **`maxAge`** counts from when Kollaudo received the run.

## Consequences

- Removing a step, or a kind from a gate, no longer weakens it: the rules are in Kollaudo, and
  changing them leaves a revision with its author.
- A team can start without a policy, as today, and add one when it wants guarantees.
- `deployed: true` makes deployments part of the evidence: an environment whose deployments aren't
  reported, with the Argo CD recipe or `kollaudo deployed`, can't pass it.
- Verdicts are still computed when asked ([0013](0013-verdict-pass-fail-unknown.md)): a new revision
  changes the verdict of past versions too. The revision in each answer, and the log of answers
  ([0019](0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)), tell which rules gave which answer.
- Policies apply to one project. Rules shared by several projects are copies of the same file, until
  there is a reason to do more.
