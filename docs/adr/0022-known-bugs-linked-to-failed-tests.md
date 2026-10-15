# 22. A failed test can be linked to a known bug and a known bug never changes the verdict

- Status: accepted
- Date: 2026-10-13
- Extends: [0007](0007-scoped-api-tokens.md), [0013](0013-verdict-pass-fail-unknown.md),
  [0017](0017-trust-in-evidence.md)

## Context

Part 2 of the plan for v0.5 ([milestone](../milestones/v0.5.md)) lets a tester say that a failed test
fails because of a bug that is already open. Today a `fail` says which kinds failed and how many tests
failed, but not whether the failure is new. A team that has a bug open for a week sees the same
`fail` every day and can't tell it from a regression.

Three choices are costly to change once people use them: how a test is named, who may link a bug, and
what a link does to the verdict. A link is created by tools that teams configure once, such as a Jira
automation rule ([0006](0006-push-based-ingest.md)), and the verdict's JSON is read by gates
([0019](0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)).

## Decision

- **A link ties one bug to one test of one component.** It has a key (such as `SHOP-412`), a URL, a
  state (`open` or `closed`), the component, and the name of the test. A bug that causes several
  tests, or a test that has several bugs, is several links: one row for each pair of bug and test.
  Links are unique by project, component, key and test. A link holds for every version and
  environment until its bug is closed, because a bug outlives the run that found it.
- **A test is named by its suite and its name**, joined by ` › `: `checkout › pays with a saved
  card`. This is the name a tester reads in a report. A suite given as a list and one given as a
  string separated by ` > ` (older reporters, see [0008](0008-ctrf-for-test-results.md)) give the
  same name. The file is not part of it: files move in refactors, and JUnit often has no reliable
  path ([0015](0015-junit-converted-by-the-cli.md)). The cost is that renaming a test drops its
  link. The verdict says so: a link whose test didn't fail in the run is listed as not matching, and
  is never silently ignored.
- **A link is created with an `ingest` token.** `POST /v1/bugs` takes a key, a URL, a state, a
  component and a list of tests, and creates or updates the links of that key. Sending a bug with
  state `closed` closes all its links. The limits of the token to components and environments apply
  ([0017](0017-trust-in-evidence.md)), and its name is recorded as the author. No new scope is added:
  a link can't let a version through, and a value of the `token_scope` enum can't be taken back once
  released ([0021](0021-signoff-as-a-test-run-with-its-own-scope.md)). If a dedicated scope turns out
  to be needed, a later ADR adds it.
- **A known bug never changes the verdict.** A failed test with an open bug still fails its run, and
  the run still fails the verdict. Letting a version through is what an override is for, with a reason
  and an expiry ([0018](0018-overrides.md)). The exit codes of `kollaudo verdict` don't change.
- **The verdict says which failures are known.** For each failed test it gives the name and either
  the bug (key, URL, state) or `null`, and its message summarizes them: `2 failed: 1 known (SHOP-412),
  1 new`. The same data is in `kollaudo verdict --json`. Only an `open` link marks a failure as known:
  a test that keeps failing after its bug was closed is new again, which is the signal a team wants.
  A flaky test that passed on retry isn't a failure and isn't listed.
- **A link is per component, not per environment.** A bug that fails a test in `staging` fails it in
  `production` too. An optional environment on a link can be added later, without changing what is
  stored now.

## Consequences

- A `fail` becomes readable: new failures are listed apart from the ones a team already knows, in the
  reasons, in the JSON and in the UI.
- Links are a new table, which `pnpm --filter @kollaudo/server db:generate` produces. The verdict
  response gets new optional fields; clients that ignore them keep working.
- Nothing stops a pipeline holding an `ingest` token from marking every failure as known. The verdict
  stays `fail` and the author is recorded, so the harm is a misleading reason, not a version let through.
- Renaming a test drops its link until it is sent again. The verdict names the link that matched
  nothing, so it can be fixed.
- Closing a bug is a request: Kollaudo never reads Jira or any other tool, it receives
  ([0006](0006-push-based-ingest.md)). If the request is lost, the link stays open until it is sent again.
- Teams update the server before the tools that send links.
