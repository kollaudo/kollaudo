# 23. The API only grows within a major version

- Status: proposed
- Date: 2026-10-22
- Extends: [0004](0004-own-internal-model.md)

## Context

The README says the API can still change before 1.0. That is honest but it doesn't say what is safe
to build on. Other people's tools already depend on it: the GitHub Action
([0020](0020-github-action.md)) and the recipes read the exit codes of `kollaudo verdict`. A Jira
automation rule is configured once and then left alone ([0022](0022-known-bugs-linked-to-failed-tests.md)).
Policy files live in the repositories of the teams that use them.

Today every change is judged on its own. Version 0.5 added `failures`, `unmatchedBugs` and `signoff`
as optional fields and nobody had to change anything, but that was a habit and not a rule. A rule is
cheap to write now and costly to add once people have built on the API without one.

[0004](0004-own-internal-model.md) already keeps CTRF and CDEvents from setting the shape of `/v1`.
This ADR says what happens to `/v1` itself.

## Decision

**What the rule covers.** The public surface is:

- the HTTP API under `/v1` as `/v1/openapi.json` describes it: paths and methods; request and
  response fields; status codes; token scopes;
- the exit codes of `kollaudo verdict` and the output of `--json`;
- the format of the policy file.

It does not cover the web UI and the database schema. It does not cover the text of messages either:
tools should read the status code or the exit code and show the text to a person.

**Within a major version the surface only grows.**

- New endpoints and new optional request fields are allowed.
- New response fields are allowed. A client ignores the response fields it doesn't know.
- A policy key that is new is optional and its default keeps the old behavior.
- We never remove or rename an endpoint or a field or a scope. We never change the type or the meaning
  of a field. We never make an optional request field required.
- A response enum gains a value only when the docs say it is open. The verdict stays `pass`, `fail` or
  `unknown` ([0013](0013-verdict-pass-fail-unknown.md)).
- **The exit codes of `kollaudo verdict` don't change:** 0 pass and 1 fail and 2 unknown and 3 no
  verdict. A new situation never takes an existing code with another meaning.

**Order of upgrade.** A server works with the CLI versions and the policy files written for earlier
releases of the same major version. The reverse isn't promised: a newer CLI or policy can use
something an older server doesn't have, as with `/v1/bugs` in 0.5. Update the server first. This is
what the changelog already tells users.

**A breaking change needs a new major version.** It gets a new path (`/v2`) served next to `/v1`. The
old one is marked `deprecated` in `openapi.json`, in the docs and in the changelog before it goes away,
and goes away only in the next major version of Kollaudo.

**Before 1.0.** The guarantee above is the default for every 0.x release: we add and we don't remove.
A breaking change is still possible until 1.0 but it must:

- have its own **Breaking** heading in the `[Unreleased]` section of `CHANGELOG.md`;
- say how to upgrade;
- never change an exit code of `kollaudo verdict`.

From 1.0 on the rule has no exception.

## Consequences

- Teams can build on the exit codes and on the fields they use today. A gate written now keeps working.
- A field that turns out to be wrong stays until the next major version. New fields need a careful
  design. The habit of shipping them optional first becomes a rule.
- The OpenAPI document of the last release can be compared with the current one in CI to catch a
  removal. That check isn't part of this decision and can come as a follow-up.
- The README line about the API changing before 1.0 should say what this ADR says once it is accepted.
- The Action and the recipes can rely on the exit codes without checking the version of the CLI.

## Open questions

To settle before this ADR is accepted:

- How long `/v1` stays served next to `/v2`: a fixed time or a number of minor releases.
- Whether the web UI gets any promise, such as stable links to a verdict page.
- Whether the rule starts now for 0.x or only at 1.0, with the **Breaking** heading as the only
  constraint until then.
