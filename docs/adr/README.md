# Architecture Decision Records

Each file records one decision: its context, the decision itself and its consequences.
Until v0.1 is released, ADRs can still be edited. From then on, a decision is never edited once
accepted: if it changes, a new ADR supersedes it (see [0001](0001-record-architecture-decisions.md)).

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| | **Principles** | |
| [0002](0002-judge-never-orchestrate.md) | Kollaudo judges, it never orchestrates | accepted |
| [0003](0003-tool-agnostic-core.md) | Tool-agnostic core | accepted |
| | **Model** | |
| [0004](0004-own-internal-model.md) | Own internal data model | accepted |
| [0005](0005-create-on-first-use.md) | Components, environments and versions are created on first use | accepted |
| | **Ingest and formats** | |
| [0006](0006-push-based-ingest.md) | Push-based ingest | accepted |
| [0007](0007-scoped-api-tokens.md) | API tokens have one project and one scope | accepted |
| [0008](0008-ctrf-for-test-results.md) | CTRF as the native format for test results | accepted |
| [0009](0009-cdevents-in-and-out.md) | CDEvents as an optional input and output | accepted |
| | **Architecture and technology** | |
| [0010](0010-self-hosted-api-first.md) | Self-hosted and API-first | accepted |
| [0011](0011-typescript-monorepo.md) | TypeScript monorepo | accepted |
| [0012](0012-server-stack.md) | Server stack: Node.js, Hono, Zod, Drizzle and PostgreSQL | accepted |
| | **Verdict** | |
| [0013](0013-verdict-pass-fail-unknown.md) | The verdict is pass, fail or unknown | accepted |
| [0014](0014-policy.md) | Policies decide what a verdict requires | accepted |
| | **Formats** | |
| [0015](0015-junit-converted-by-the-cli.md) | JUnit XML is converted to CTRF by the CLI | accepted |

## Template

```markdown
# N. Title

- Status: proposed | accepted | superseded by [NNNN](NNNN-title.md)
- Date: YYYY-MM-DD

## Context
## Decision
## Consequences
```
