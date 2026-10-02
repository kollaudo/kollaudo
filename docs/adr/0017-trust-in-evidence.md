# 17. Evidence says who sent it, and tokens limit what they can send

- Status: accepted
- Date: 2026-10-02
- Extends: [0007](0007-scoped-api-tokens.md)

## Context

A verdict is only as good as its evidence, and Kollaudo receives evidence from the same pipelines it
judges ([0006](0006-push-based-ingest.md)). Today, any `ingest` token of a project can send results
for any component and environment of the project, and Kollaudo doesn't record which token sent a
test run or a deployment. A pipeline that should only send staging results for one component can
send production results for another, and nobody can tell afterwards.

It has been suggested that verdicts should no longer be given to `ingest` tokens, because a token
that sends a green report can then ask for a `pass`. That doesn't close the gap: a gate that asks
with another token still reads the green report. What matters is who can write evidence, for what,
and whether Kollaudo can tell where it came from.

## Decision

- **Tokens can be limited** to components and environments, with names or patterns:

  ```bash
  kollaudo-server token create shop --scope ingest --name ci-staging \
    --component api --component web --environment staging --environment "pr-*"
  ```

  A token limited this way gets `403` for anything else, including build-level runs unless it allows
  them with `--build`. Tokens can have a name, shown wherever they appear.
- **Evidence records who sent it.** Every test run and every deployment keeps the token that sent
  it. Its name, or the start of the token, appears with the run, in the reasons of the verdict, and
  in the UI.
- **Later, CI identity instead of static tokens.** GitHub Actions and GitLab CI can sign a short-lived
  OIDC token that says which repository, workflow and branch is running. Kollaudo will accept those,
  for projects that trust an issuer, record their claims as the source of the evidence, and let a
  policy ([0016](0016-rules-kept-by-kollaudo.md)) require a source, such as e2e results of staging
  only from `.github/workflows/e2e.yml` on `main`. The format will have its own ADR.
- **Verdicts can still be asked with `ingest` tokens**, as 0007 decided. The official recipes give
  the gate its own `read` token, so that promoting and sending results are separate roles, and the
  docs say why.

## Consequences

- A leaked or misused `ingest` token can only send evidence within its limits.
- When a verdict surprises, its reasons say which token or pipeline sent each run.
- A pipeline can still send false results within its own limits, for example a green report for
  tests it never ran. Limits and records narrow this and make it visible; requiring a source, with
  OIDC, narrows it to one workflow. Nothing in Kollaudo can tell whether a test suite tests anything:
  that stays with the team that owns it.
- Existing tokens keep working: without limits, a token can do what it does today.
