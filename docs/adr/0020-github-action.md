# 20. A GitHub Action runs the CLI, from its own repository

- Status: accepted
- Date: 2026-10-05
- Extends: [0003](0003-tool-agnostic-core.md), [0019](0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)

## Context

GitHub Actions is the most common CI for the people Kollaudo is meant for. Today a gate there is a
`run` step with `npx @kollaudo/cli verdict`, after a step that installs Node.js: it works, but every
team writes it again, and has to know the exit codes to fail closed
([0019](0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)). An action makes the gate one step,
and can be found on the GitHub Marketplace.

Support for one tool belongs outside the core ([0003](0003-tool-agnostic-core.md)). An action has
three more constraints:

- the Marketplace lists an action only from the root of its own public repository, and one action
  per repository;
- an action is used by tag, such as `@v0`, and its code runs with the permissions and secrets of the
  workflow that uses it, so what it runs must be easy to review;
- GitHub offers three kinds of action: JavaScript, which needs a bundle committed to the repository;
  Docker, which runs only on Linux runners and starts slowly; and composite, a list of steps.

## Decision

- **The actions live in their own repository, `kollaudo/action`.** Its root is the gate, listed on
  the Marketplace: `uses: kollaudo/action@v0`. Sending results is a second action in the same
  repository, `uses: kollaudo/action/push@v0`. The core repository doesn't change.
- **They are composite actions that run the CLI.** Each one sets up Node.js 24 and runs
  `npx --yes @kollaudo/cli@<version>`, with the inputs as options. There is no other code: what the
  action does is what the CLI does, tested in the core repository. The repository has no bundle and
  no dependencies, and is short enough to read before using it.
- **Each release of the actions pins one release of the CLI.** `kollaudo/action@v0.4.0` runs
  `@kollaudo/cli@0.4.0`. Tags are the releases of Kollaudo, and `v0` moves to the latest `v0.*`.
  Teams that want to review every change pin a commit SHA instead.
- **The gate fails closed** ([0019](0019-when-the-gate-is-skipped-or-kollaudo-is-down.md)). It
  passes only when the CLI exits with `0`: `fail` (`1`), `unknown` (`2`) and no verdict (`3`) fail
  the step. The `allow` input lets `unknown`, or no verdict, through, and only when it is set; the
  run then shows a warning that says so.
- **People see why.** The gate writes the output of `kollaudo verdict`, with its reasons and the
  links to the test runs, to the summary of the workflow run. When the CLI can give the verdict as
  JSON ([#54](https://github.com/kollaudo/kollaudo/issues/54)), the action also sets `outcome` and
  `message` as outputs, and the summary becomes a table.
- **The token is an input**, passed to the CLI in its environment, never on the command line. The
  examples use a `read` token named for the gate, so that the log of verdicts says which gate asked
  ([0017](0017-trust-in-evidence.md)), and an `ingest` token limited to the component for `push`.
- **The actions are tested against Kollaudo itself**: a workflow in their repository runs the image
  of the pinned release as a service container, sends results with `push`, and checks that the gate
  passes on `pass`, fails on `fail`, `unknown` and no answer, and lets things through only with
  `allow`.

## Consequences

- Teams on GitHub Actions gate a job in one step, and find Kollaudo on the Marketplace.
- Setting up Node.js 24 changes the Node.js of the steps after it in the same job. The README of the
  action says so; jobs that need another version set it up again after the gate.
- The actions download the CLI from npm: runners need to reach the npm registry, or a mirror of it.
- Each release of Kollaudo is followed by a release of the actions, with the new CLI version and the
  test workflow run against it. The releasing guide gets that step with the first release of the
  actions.
- Other CI systems keep using the CLI and the recipes: an action for one of them would be another
  recipe outside the core, not a change to it.
