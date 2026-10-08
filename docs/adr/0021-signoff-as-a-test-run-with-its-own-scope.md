# 21. A sign-off is a test run, with a scope of its own

- Status: proposed
- Date: 2026-10-08
- Extends: [0014](0014-policy.md), [0017](0017-trust-in-evidence.md), [0018](0018-overrides.md)

## Context

The plan for v0.5 ([milestone](../milestones/v0.5.md)) lets a policy require evidence from a person:
a product owner who tries a version in `staging` and signs it off, or a tester who runs a manual
check. Today a policy can require a kind such as `uat`, but anything that sends a `uat` report
satisfies it, and the pipeline that deploys a version is the one that sends the reports
([0006](0006-push-based-ingest.md)). A green `uat` suite from CI is not a person saying "I tried it".

Two choices are costly to change once people use them: where a sign-off is stored and judged, and who
is allowed to give one. A new token scope is a value in a PostgreSQL enum (`token_scope`, in
`apps/server/src/db/schema.ts`), and a policy field is part of files that teams keep in their
repositories ([0014](0014-policy.md)).

## Decision

- **A sign-off is a test run.** It has a kind (`uat` or `manual`), a version, an environment, one
  test with an outcome (`pass` or `fail`), and a note. It is stored with the other test runs and
  judged by the same rules: `deployed` (the signed-off version must be the one deployed when it was
  given), `maxAge`, and the rule that the latest run of a kind counts. Giving a sign-off again
  replaces the earlier one. There is no second kind of evidence, no second table to join in the
  verdict, and no second set of reasons to explain.
- **It needs its own token scope, `signoff`**, separate from `ingest`, `policy` and `override`
  ([0007](0007-scoped-api-tokens.md)). The scope is added to the `token_scope` enum; existing tokens
  and their rows don't change. A `signoff` token can be limited to components and environments, and
  has a name, which is recorded as the author until Kollaudo has users
  ([0017](0017-trust-in-evidence.md), [0018](0018-overrides.md)). It can ask for verdicts, as the
  other scopes that send data can, so that `kollaudo signoff` prints the verdict that follows.
- **A policy lists the kinds that need a sign-off**, in the rule, next to `require`:

  ```yaml
  environments:
    staging:
      require: [e2e, smoke]
      signoff: [uat]
  ```

  A kind in `signoff` counts only from a run sent with a `signoff` token. A `uat` run sent with an
  `ingest` token is kept, and shown, but doesn't satisfy it, and the verdict says that the kind is
  waiting for a sign-off. A kind in `signoff` doesn't also need to be in `require`. A sign-off with
  outcome `fail` makes the verdict `fail`; a missing one makes it `unknown`
  ([0013](0013-verdict-pass-fail-unknown.md)).
- **The API says what a sign-off is.** `POST /v1/signoffs` creates one, `GET /v1/signoffs` lists them,
  and `kollaudo signoff` calls the first. Everywhere a verdict names a run, a sign-off shows its
  author, time and note.
- **It is not an override** ([0018](0018-overrides.md)). An override lets a version through without
  evidence and expires; a sign-off is evidence that a person gave, and the policy still decides what
  it is worth.

## Consequences

- Policies can ask for a person's word, and a pipeline can't give it for them: the scope, not the
  kind name, is what separates the two.
- Everything that already works on test runs works on sign-offs: limits, the record of who sent it,
  the verdict log, `maxAge`, `deployed`.
- Test runs get a marker that tells a sign-off from a report, and its note: a migration, which
  `pnpm --filter @kollaudo/server db:generate` produces. Adding a value to a PostgreSQL enum can't be
  taken back, so the name `signoff` is fixed once released.
- `signoff` is a new field of the policy format. Older servers reject a file that has it, because
  rules don't allow unknown fields, so teams update the server before the policy.
- Whoever holds a `signoff` token can sign off anything within its limits. As with `override`, it
  should be held by people, not pipelines, and limited, until users and roles replace tokens.
- Sign-offs are given with tokens, so only by people who can use a terminal or a webhook. Giving them
  in the UI waits for users and roles.
