# 13. The verdict is pass, fail or unknown

- Status: accepted
- Date: 2026-09-29

## Context

The verdict is what sets Kollaudo apart from a test report dashboard: it answers *"is this version,
in this environment, healthy?"* for whatever tool performs the promotion
([0002](0002-judge-never-orchestrate.md)).

Kollaudo is push-based ([0006](0006-push-based-ingest.md)), so it only knows what it has been sent.
A version with no failed run may be healthy, or its tests may never have run, or their report may
have been lost on the way. If missing evidence counted as *pass*, a broken pipeline step would
silently open every gate.

## Decision

- The verdict is for one **version** of one **component** in one **environment**, and is one of:
  - `pass`: every piece of evidence the [policy](0014-policy.md) requires is there, and none of it
    failed;
  - `fail`: at least one required piece of evidence failed;
  - `unknown`: nothing failed, but some required evidence is missing.
- `fail` wins over `unknown`: a failure is conclusive even if other evidence is missing.
- For each kind of test, the **latest run** of that version in that environment counts. A run
  after a fix replaces the one that failed, and the earlier runs stay in the history.
- A run fails when it has failed tests. A run with no tests is not evidence, and counts as missing.
- Every verdict comes with its **reasons**: for each required kind, the run it used, its counts and
  why it passed, failed or is missing. A verdict that can't be explained can't be trusted, or fixed.
- The verdict is computed when it is asked for, from the data at that moment. It is not stored.
- Gates treat `unknown` as not passed by default. The CLI makes the three outcomes distinct:

  ```bash
  kollaudo verdict --component api --env staging --version 1.4.2
  # exit code 0 = pass, 1 = fail, 2 = unknown, 3 = no verdict (network, token, usage error)
  ```

  A pipeline can choose to let `unknown` through, or to go ahead when Kollaudo can't be reached,
  but it has to say so explicitly.
- To promote a version *to* an environment, a gate asks for the verdict of the environment it comes
  *from*: before production, the verdict of the version in staging.

## Consequences

- A missing report blocks a promotion instead of approving it. Teams notice a broken reporting step
  the first time they need the gate.
- The UI shows three states, not two, and uses the muted color for `unknown`.
- Since the verdict isn't stored, changing the policy changes the verdict of past versions too. To
  know why a gate passed at a given time, the gate's own logs keep the verdict and reasons it received.
- Emitting verdicts as CDEvents ([0009](0009-cdevents-in-and-out.md)) will need them computed at a
  point in time, for example when a run is received.
