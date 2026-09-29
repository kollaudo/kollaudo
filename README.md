# Kollaudo

> *Collaudo* (Italian): the final acceptance test before something is put into service.

**The health passport of every version, from first commit to production.**

*Is this version, in this environment, healthy?* Whether it's a commit on a feature branch running in
a preview environment, the latest `main` on `dev`, or `1.4.2` about to reach production, today the
answer is scattered across your CI, your test reports, your code-quality tools, your UAT spreadsheets
and your deployment tools. Kollaudo brings those signals together around what you test and ship:
a **version** running in an **environment**.

```
api 1.4.2  (commit a1b2c3, tag v1.4.2)
├── Build       unit ✅ 412/412 · coverage 81% · static analysis ✅
├── Dev         deployed Mon 09:10 · e2e ✅ 98/98
├── Staging     deployed Tue 10:42 · e2e ✅ 96/98 (2 flaky) · UAT ⚠️ 1 open bug
├── Production  waiting
└── Verdict     ❌ not promotable: UAT bug #17 is open
```

Kollaudo doesn't build, test or deploy anything. There are plenty of great tools for that.
It **collects their results and judges**.

> ⚠️ Early development. Not ready for production use yet.

## What it does

- **Tracks tests on deployed versions**: e2e, smoke, UAT and manual acceptance checks, per
  version and per environment. This is the heart of Kollaudo.
- **Adds build signals as context**: unit tests, coverage and static analysis, shown on the version
  they belong to.
- **Records deployments** from any delivery tool: which version runs in which environment,
  including ephemeral preview environments.
- **Links bugs** to the version and the test that found them.
- **Follows a version over time**: from a commit on a branch, through `dev` and `staging`, to a
  tagged release in production.
- **Answers one question** over a plain HTTP API: *is this version, in this environment, healthy?*
- **Gates promotions** in any tool that can call a URL or run a command.

Test results come from any framework and any CI, via open formats ([CTRF](https://ctrf.io), JUnit XML).

## What it is not

- **Not a CI system.** It doesn't build your code.
- **Not a test runner.** Your CI and your testers run the tests; Kollaudo receives the results.
- **Not a deployment or promotion tool.** It doesn't deploy or promote anything; it tells your tools whether they should.
- **Not a DORA or observability dashboard.** It decides whether a version is healthy,
  not how fast your team delivers.

## Core concepts

Kollaudo's model is tool-agnostic. Every delivery process has these, whatever it calls them:

| Kollaudo | Examples |
|---|---|
| **Component** | a service, an app, a library you build and ship |
| **Environment** | `dev`, `staging`, `production`, a cluster, a namespace, a preview environment for a pull request |
| **Version** | whatever identifies what you test: a git SHA, a pull request build, an image tag, a release candidate, a semver tag, a Kargo Freight. It can carry its commit, branch, tag and pull request |
| **Deployment** | "version X of component Y is now running in environment Z" |
| **Test run** | results of a test session, tied to a version: on the build (unit, static analysis) or in an environment (e2e, smoke, UAT, manual) |
| **Verdict** | *pass* or *fail* for a version in an environment, with the reasons |

A **release** is simply a version you tagged and shipped: Kollaudo shows releases as a view over
versions, not as a separate concept.

## How it works

```
Any CI / script    ── kollaudo CLI ──►┐
Anything with HTTP ── API /v1     ──►├──►  Kollaudo  ──►  verdict
CDEvents tools     ── CDEvents    ──►┘                    (UI, API, CLI)
```

- **Push-based.** Tools send data to Kollaudo. It never needs credentials to your systems.
- **Self-hosted.** One container plus PostgreSQL. Your test and deployment data stay with you.
- **API-first.** The bundled UI uses only the public API, so you can build on the same data:
  Backstage, Grafana, your own portal.

## Works with anything

Kollaudo's core knows nothing about specific tools. Everything comes in through three generic
entry points:

| Entry point | Use it from |
|---|---|
| `kollaudo` CLI | any CI or script: GitHub Actions, GitLab CI, Jenkins, Azure DevOps, bash… |
| HTTP API `/v1` | anything that can send a request |
| [CDEvents](https://cdevents.dev) | any tool that emits them: Tekton, Jenkins, Testkube… |

The verdict is just as generic: any promotion tool that can call a URL or run a command can use it
as a gate.

```bash
kollaudo verdict --component api --env staging --version 1.4.2   # exit code 0 = pass, 1 = fail
```

Ready-made **recipes** turn popular tools' events into those calls.

| Recipe | Status |
|---|---|
| Playwright (CTRF reporter) | planned for v0.1 |
| GitHub Actions | planned |
| Argo CD notifications | planned |
| Kargo verification gate | planned |
| Flux, GitLab, Argo Rollouts, Flagger, Spinnaker… | contributions welcome |

## Quick start

*Coming with v0.1.* See the [v0.1 scope](docs/milestones/v0.1.md).

```bash
docker compose up
docker compose exec kollaudo kollaudo-server project create demo   # prints an ingest and a read token

export KOLLAUDO_URL=http://localhost:8080
export KOLLAUDO_TOKEN=<ingest token>

# e2e results from Playwright's CTRF reporter, run against staging
npx @kollaudo/cli push ctrf-report.json \
  --component frontend --env staging --version 1.2.0
```

Then open the UI, add the project with its read token, and see the health of each component in
each environment.

## Roadmap

1. **Tests on deployed versions** (the core)
   - **v0.1**: CTRF ingest, CLI, component × environment health view
   - **v0.2**: JUnit, deployments, verdict API, first recipes (GitHub Actions, Argo CD)
   - **v0.3**: bugs linked to failed tests, UAT and manual acceptance checks
   - **v0.4**: gate recipes (Kargo, CI step, GitHub deployment protection), CDEvents in/out
2. **Build signals**: unit tests, coverage, static analysis and SARIF as version context
3. **After production**: post-deploy checks, rollbacks and incidents linked to versions

## Design decisions

Architecture decisions are recorded in [`docs/adr/`](docs/adr/README.md). The scope of each
milestone is in [`docs/milestones/`](docs/milestones/).

## Development

Requires Node.js 24 and Docker. The repository is a pnpm monorepo
(see [ADR 0011](docs/adr/0011-typescript-monorepo.md)).

```bash
corepack enable                                     # provides the pinned pnpm version
pnpm install
docker compose -f deploy/docker-compose.yml up -d   # PostgreSQL for local development
cp apps/server/.env.example apps/server/.env
pnpm admin project create demo                      # prints an ingest and a read token
pnpm dev                                            # API on :8080, UI with hot reload on :5173
pnpm check && pnpm typecheck && pnpm test           # what CI runs
```

`pnpm build` also builds the UI, which the server then serves on :8080 as in production.

Tests that need a database create a temporary one on the local PostgreSQL, or on
`TEST_DATABASE_URL`, and drop it when they finish.

After changing `apps/server/src/db/schema.ts`, generate a migration with
`pnpm --filter @kollaudo/server db:generate`.

## Contributing

The project is at a very early stage. Ideas, use cases and feedback are welcome in
[Issues](https://github.com/kollaudo/kollaudo/issues). See the
[contributing guide](https://github.com/kollaudo/.github/blob/main/CONTRIBUTING.md) before opening a
pull request, and the [security policy](https://github.com/kollaudo/.github/blob/main/SECURITY.md) to
report a vulnerability.

## License

[Apache-2.0](LICENSE)
