# 5. Components, environments and versions are created on first use

- Status: accepted
- Date: 2026-09-29

## Context

Versions appear continuously: every commit, pull request build and tag is a new one. Preview
environments come and go with pull requests. Asking users to register each of them before sending
data would make adoption heavy, which [0002](0002-judge-never-orchestrate.md) rules out.

## Decision

- A **project** is created explicitly, by an administrator, together with its API tokens
  (see [0007](0007-scoped-api-tokens.md)). Since every token belongs to one project, senders never
  need to name the project.
- **Components**, **environments** and **versions** are created automatically the first time data
  refers to them, matched by name within the project (and, for versions, within the component).
- Metadata sent later for an existing version (`commit`, `branch`, `tag`, `pullRequest`, `digest`) fills in
  missing fields. It never overwrites a field that is already set with a different value: that
  request is rejected, because it means two different builds share the same version identifier.

## Consequences

- Sending the first test report is one command, with no setup beyond a token.
- A typo in a name creates a new component or environment. The UI and the API must make it easy to
  rename, merge and archive them.
- Version identifiers must be unique per component. Teams that reuse tags such as `latest` should
  send a unique version (for example the commit SHA) and put the tag in the metadata.
- The same commit can produce different artifacts, for example when a base image is rebuilt.
  Sending the `digest` makes Kollaudo reject results of a different artifact under the same version.
- In a monorepo, one commit gives a version to each component it builds, and each is judged on its own.
