# 18. Overrides let a version through, with who, why and until when

- Status: accepted
- Date: 2026-10-02

## Context

A gate that can't be overridden gets removed. When a fix has to reach production at night and the
verdict is `unknown`, because the e2e environment is down or a flaky test blocks it, the team will
go around Kollaudo: by editing the pipeline, or by sending a report that says what the gate wants to
hear. Either way the record of what happened is lost, and the gate is often not put back.

## Decision

- An **override** lets one version of one component through in one environment:

  ```bash
  kollaudo override --component api --env staging --version 3f2a9c1 \
    --reason "Hotfix for incident 1234, e2e environment down" --for 4h
  ```

- It needs a token of the new `override` scope, separate from `ingest` and `policy`: the pipeline
  that sends results can't override its own gate. Tokens have a name
  ([0017](0017-trust-in-evidence.md)), which is recorded as the author until Kollaudo has users.
- A **reason** is required, and every override **expires**: after 4 hours unless given, after 24 hours
  at most. It can be revoked before.
- While it holds, the verdict is `pass`, and says so: it carries the override, with its author,
  reason and expiry, and the outcome the evidence alone would give. `kollaudo verdict` exits with
  `0` and prints `PASS (override)` with the reason, so the log of the gate shows it.
- Overrides are kept, expired or not, and listed with `GET /v1/overrides`. The UI marks the versions
  that went through with one.

## Consequences

- Urgent fixes go through the gate instead of around it, and leave a record.
- Overrides are visible, so a team can see when they become a habit, which says something about its
  tests or its environments.
- Whoever holds an `override` token can let anything through. It should be held by people, not
  pipelines, until users and roles replace tokens.
