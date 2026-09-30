# 7. API tokens have one project and one scope

- Status: accepted
- Date: 2026-09-29

## Context

[0006](0006-push-based-ingest.md) and [0005](0005-create-on-first-use.md) authenticate senders with
API tokens scoped to a project. The same token would also be pasted into the UI to read data, until
Kollaudo has users and single sign-on.

Tokens used for sending data live in CI secrets and can end up in logs. A leaked sending token
shouldn't expose a project's data, and a token given to someone to look at the results shouldn't
let them send fake ones. One person can also follow several projects on the same instance.

## Decision

- Every token belongs to **one project** and has **one scope**:
  - `ingest`: can only send data (test runs, and later deployments and events);
  - `read`: can only read data through the API and the UI.
- Asking for a verdict ([0013](0013-verdict-pass-fail-unknown.md)) is allowed with either scope.
  A gate in CI can use the `ingest` token it already has, and the verdict only tells it the outcome
  and the runs behind it, not the tests.
- Tokens look like `kol_<random>`, with at least 256 bits of randomness. The prefix makes leaked
  tokens easy to recognize and to find with secret scanners.
- Only a SHA-256 hash of each token is stored. A token is shown once, when it is created, and can be
  revoked. Kollaudo records when each token was last used.
- A request with a missing, unknown or revoked token gets `401`. A valid token with the wrong scope
  gets `403`.
- Until Kollaudo has users, projects and tokens are managed only with the server's admin command,
  which needs access to the host or container:

  ```bash
  kollaudo-server project create <project>              # prints one ingest and one read token
  kollaudo-server token create <project> --scope read   # or --scope ingest
  kollaudo-server token list <project>
  kollaudo-server token revoke <token-id>
  ```

- The UI stores several `read` tokens in the browser, one per project, and lets the user switch
  between projects.

## Consequences

- CI only ever holds `ingest` tokens, so a leak can't be used to read results.
- One instance serves many projects, and one person can follow all of theirs from the same UI.
- Managing many tokens by hand gets tedious for large teams. Users, roles and single sign-on will
  replace pasted `read` tokens in the UI, in a later ADR.
- There is no HTTP API for managing projects and tokens yet, so it can't be automated remotely.
