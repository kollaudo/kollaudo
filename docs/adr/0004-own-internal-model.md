# 4. Own internal data model

- Status: accepted
- Date: 2026-09-29

## Context

The open standards Kollaudo builds on, CTRF and CDEvents, are both pre-1.0 and have already shipped
backward-incompatible changes. Using either as the internal model would tie the database, the API and
the UI to someone else's release schedule.

## Decision

Kollaudo has its own data model, independent of any input format:

- **Project**: a group of components delivered together.
- **Component**: something that is built and shipped, such as a service or an app.
- **Environment**: where a version runs, such as `dev`, `staging`, `production`, or an ephemeral
  preview environment for a pull request.
- **Version**: an identifier chosen by the user for what is tested (git SHA, pull request build,
  image tag, release candidate, semver tag, Kargo Freight…), treated as an opaque string and unique
  per component. It can carry optional metadata: `commit`, `branch`, `tag`, `pullRequest`, and the `digest` of the
  artifact that was built, such as a container image digest.
- **Deployment**: a version of a component running in an environment, at a point in time.
- **Test run**: results of a test session, tied to a component and a version. It has a *kind*
  (`unit`, `e2e`, `smoke`, `uat`, `manual`…) and belongs to one of two levels:
  - **build level**, with no environment: tests on the code (unit, static analysis), whose result
    is the same wherever the version runs. They are context for the version.
  - **environment level**, with an environment: tests on the deployed version (e2e, smoke, UAT,
    manual checks), whose result can differ between staging and production. They are the core of
    the verdict.
- **Verdict**: *pass*, *fail* or *unknown* for a version in an environment, with the reasons
  ([0013](0013-verdict-pass-fail-unknown.md)).
- **Policy**: the rules a verdict applies ([0014](0014-policy.md)).

Input formats are converted into this model at the edge, by ingest adapters.

The model is called **Version**, not *Release*, because Kollaudo follows what is tested from the
first commit on a branch to production, not only what has been officially released. A *release* is
a version that was tagged and shipped: it is a view over versions (for example, versions with a
`tag`), not a separate entity.

## Consequences

- A change in an external standard only affects its adapter.
- The public API `/v1` is defined on this model, and can stay stable.
- Converting inputs costs some work, and fields a standard adds are not visible until an adapter maps them.
