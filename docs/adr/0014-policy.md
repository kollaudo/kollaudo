# 14. Policies decide what a verdict requires

- Status: accepted
- Date: 2026-09-29

## Context

A verdict ([0013](0013-verdict-pass-fail-unknown.md)) applies rules: which kinds of test are
required in `staging`, whether flaky tests are acceptable, whether a run from last month still
counts. These rules differ between environments and components, and they change over time. If they
were hidden in the code, or scattered across the flags of every gate, nobody could tell why a
version passed.

The first version of [Keptn](https://keptn.sh) asked for SLIs and SLOs to be defined before it could
judge anything ([0002](0002-judge-never-orchestrate.md)), which is a lot to set up before the first
verdict.

## Decision

- A **policy** is the set of rules a project's verdicts apply. It can set, per environment and
  optionally per component:
  - the **required kinds** of environment level runs, such as `e2e` and `smoke`;
  - the required kinds of **build level** runs, such as `unit`;
  - whether **flaky** tests fail a run;
  - a **maximum age** after which a run no longer counts.
- Every project starts with a **default policy**, so verdicts work with no configuration:
  - at least one environment level run, of any kind, is required;
  - every kind that has runs for that version in that environment is judged by its latest run;
  - flaky tests that passed in the end don't fail a run, and are listed in the reasons;
  - build level runs are context, not evidence.
- A gate can **tighten** the policy for one request, for example by requiring more kinds, but never
  relax it.
- Policies are **code**: a file in the team's repository, reviewed like any other change, and sent
  to Kollaudo by CI. Kollaudo keeps every revision, and each verdict names the revision it applied.
  Sending a policy needs its own token scope, so a CI job that can send test results can't also
  relax the rules they are judged by ([0007](0007-scoped-api-tokens.md)).

The default policy and the request-level rules come first. Policy files come with a later milestone,
in their own ADR for the file format.

## Consequences

- Adopting the verdict needs no setup: the default policy works on whatever data a team already sends.
- The default policy only judges the kinds it has seen. A kind of test that stops running doesn't
  make the verdict `unknown` until the policy requires it.
- Rules live in two places while policy files don't exist: the defaults, and the flags of each gate.
  Pipelines version their flags, but the UI can only show verdicts under the default policy.
- The same data can give different verdicts under different policy revisions, so the reasons must
  always name the policy that produced them.
