# 19. Gates fail closed when Kollaudo doesn't answer, and skipped gates are visible

- Status: accepted
- Date: 2026-10-02
- Extends: [0002](0002-judge-never-orchestrate.md)

## Context

Kollaudo never deploys ([0002](0002-judge-never-orchestrate.md)): a promotion happens in a pipeline,
Kargo or Argo Rollouts, which asks for a verdict. Two things are out of Kollaudo's hands:

- **when it can't answer**, each gate decides what to do. A gate that goes ahead without a verdict
  is no gate, and one that stops blocks every deployment while Kollaudo is down;
- **when nobody asks**, because a gate was removed or never added, Kollaudo can't stop anything. A
  promotion without a gate looks the same as one with a gate.

## Decision

- **The official recipes fail closed.** When the verdict can't be had (`kollaudo verdict` exits with
  `3`, or the request fails or times out), the gate doesn't promote. Going ahead without a verdict
  is an explicit choice in the recipe, written next to the gate with the reason for it. The docs
  recommend failing closed towards production and other shared environments, and allow failing open
  towards development and preview environments.
- **Kollaudo keeps a log of the verdicts it gives:** component, environment, version, outcome,
  policy revision, override, which token asked, and when. Verdicts are still computed when asked
  ([0013](0013-verdict-pass-fail-unknown.md)); the log records the answers, it isn't the source of
  later ones.
- **A deployment without a gate is marked.** A policy says where versions of an environment come
  from (`from: staging`, [0016](0016-rules-kept-by-kollaudo.md)). A deployment to that environment is
  *gated* when the log has a `pass` for the same version in the environment it comes from, given
  before the deployment. Otherwise it is *ungated*: the deployment API, the verdict of that
  environment and the UI say so.
- Kollaudo is made easy to keep up: several replicas behind the Helm chart, and a readiness check that
  includes the database.

## Consequences

- Failing closed makes Kollaudo something production promotions depend on, and its availability
  matters like that of the tools around it. Overrides ([0018](0018-overrides.md)) are the way
  through when it's down for a version that has to go out.
- Kollaudo can't prevent a promotion that doesn't ask for a verdict, but it can show it: an ungated
  deployment to production is visible the moment it is reported.
- Ungated deployments need the policy to say where versions come from, and deployments to be
  reported, as with the Argo CD recipe.
