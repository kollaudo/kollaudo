<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/title-dark.svg">
    <img src="docs/assets/title.svg" alt="Kollaudo" width="520">
  </picture>
</h1>

> *Collaudo* (Italian): the final acceptance test before something is put into service.

**Quality gates for every promotion, whatever builds, tests and deploys your software.**

Your CI sends test results to Kollaudo. Before a version moves on, from `dev` to `staging` or from
`staging` to production, your pipeline, Kargo or Argo Rollouts asks one question: *is this version
healthy here?* Kollaudo answers **pass**, **fail**, or **unknown** when the tests never reported,
which blocks a promotion too.

```console
$ kollaudo verdict --component checkout --env staging --version 9d07e6b --require e2e
FAIL  checkout 9d07e6b in staging: e2e failed.

  fail     e2e  1 failed, 14 passed, 2 flaky  https://kollaudo.example.com/test-runs/645d271b-…
$ echo $?
1
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/matrix-dark.png">
  <img src="docs/assets/screenshots/matrix-light.png" alt="Kollaudo's health matrix: the latest tested version of each component in each environment, with the counts of passed, failed and flaky tests. The checkout component fails on staging.">
</picture>

Kollaudo doesn't build, test or deploy anything: there are plenty of great tools for that. It
**collects their results and judges**, and the tool that promotes does what the verdict says.

> **v0.1 is out.** It's young: the API can still change before 1.0, and feedback is very welcome in
> [Issues](https://github.com/kollaudo/kollaudo/issues).

## Quick start

```bash
curl -O https://raw.githubusercontent.com/kollaudo/kollaudo/main/deploy/docker-compose.yml
docker compose up -d
docker compose exec kollaudo kollaudo-server project create demo   # prints an ingest and a read token

export KOLLAUDO_URL=http://localhost:8080
export KOLLAUDO_TOKEN=<ingest token>

# an example report of e2e tests run against staging, as Playwright's CTRF reporter writes it
curl -O https://raw.githubusercontent.com/kollaudo/kollaudo/main/docs/examples/ctrf-report.json
npx --yes @kollaudo/cli push ctrf-report.json \
  --component frontend --env staging --version 1.2.0

# can 1.2.0 leave staging? No: a test failed, so the verdict is FAIL and the exit code 1
npx --yes @kollaudo/cli verdict --component frontend --env staging --version 1.2.0
```

Then open http://localhost:8080, add the project with its **read** token, and see the health of
each component in each environment. To send your own results, see
[sending test results](docs/sending-results.md).

## How it fits in your delivery

```
 CI (GitHub Actions, Azure DevOps, GitLab, Jenkins…)
   build ─► deploy to dev ─► run tests ─► kollaudo push ───────────┐
                                                                    ▼
 Promotion (a pipeline step, Kargo, Argo Rollouts…)            Kollaudo
   "can 9d07e6b go from dev to staging?" ─── kollaudo verdict ─►  pass / fail / unknown
```

- **In a pipeline**, `kollaudo verdict` is one step: a non-zero exit code stops the deployment.
- **With Kargo or Argo Rollouts**, an analysis calls `GET /v1/verdict` and Freight only reaches
  the next stage when the verdict is `pass`.
- **Kollaudo is never in the way.** It doesn't deploy, so if it's down, delivery keeps working:
  each gate decides whether to wait or go ahead ([ADR 0002](docs/adr/0002-judge-never-orchestrate.md)).

See [sending test results](docs/sending-results.md) for any framework and CI, and the
[Playwright recipe](docs/recipes/playwright.md) for a complete example.

## Who it's for

Teams that ship several components through several environments, with tests at each step, and
want one answer before promoting a version: *can it go?*

- Your delivery is split across tools: one CI builds, another runs e2e tests, Argo CD or Flux
  deploys, Kargo or a pipeline promotes, and testers sign off somewhere else.
- You want promotion gates that don't depend on any one of them, and that you can keep when you
  change tools.
- You want a missing test run to block a release, not to go unnoticed.

If one CI system does all of this for you and its gates are enough, you probably don't need Kollaudo.

## What it does

**Today (v0.1)**

- **Receives test results** from any framework, as [CTRF](https://ctrf.io) reports, for a version of
  a component in an environment, or at build level for unit tests.
- **Judges a version in an environment**: `pass`, `fail` or `unknown`, with the reasons, over the
  HTTP API and with `kollaudo verdict`. Required kinds of test, such as `e2e` and `smoke`, can be
  set per gate.
- **Shows the health of each project**: the latest tested version of every component in every
  environment, and the tests of each run.
- **Runs anywhere** as one container next to PostgreSQL, with several projects and scoped tokens.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/run-dark.png">
  <img src="docs/assets/screenshots/run-light.png" alt="A test run in Kollaudo: 15 tests of checkout 9d07e6b on staging. The failed test comes first with its error message, and flaky tests are marked.">
</picture>

**Next** ([roadmap](#roadmap))

- JUnit XML, deployments from Argo CD and other tools, policies as code, a Helm chart, and recipes
  for Kargo and Azure DevOps.
- Bugs linked to failed tests, and UAT sign-offs and manual checks from the tools where testers work.
- Build signals as context: coverage, static analysis.

## What it is not

- **Not a CI system.** It doesn't build your code.
- **Not a test runner.** Your CI and your testers run the tests; Kollaudo receives the results.
- **Not a deployment or promotion tool.** It doesn't deploy or promote anything; it tells your tools whether they should.
- **Not a test management tool.** It doesn't store test cases or plan test campaigns. It records
  the results and sign-offs that come out of them.
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
| **Verdict** | *pass*, *fail* or *unknown* for a version in an environment, with the reasons. *Unknown* means evidence is missing, and it never counts as a pass |
| **Policy** | the rules a verdict applies: which kinds of test each environment requires, whether flaky tests count, how old a run can be |

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
kollaudo verdict --component api --env staging --version 1.4.2
# exit code 0 = pass, 1 = fail, 2 = unknown, 3 = no verdict (network, token, usage error)
```

[Sending test results](docs/sending-results.md) explains the three steps for any test framework
and any CI: write a CTRF report, `kollaudo push` it, gate on `kollaudo verdict`.

Ready-made **recipes** are complete examples for popular tools.

| Recipe | Status |
|---|---|
| [Playwright with GitHub Actions](docs/recipes/playwright.md) | available |
| GitHub Actions | planned |
| Argo CD notifications | planned |
| Kargo verification gate | planned |
| Backstage plugin | planned |
| Flux, GitLab, Argo Rollouts, Flagger, Spinnaker… | contributions welcome |

## Roadmap

1. **Tests on deployed versions** (the core)
   - **v0.1**: CTRF ingest, CLI, verdict API and `kollaudo verdict` with the default policy,
     component × environment health view
   - **v0.2**: policies as code, JUnit, deployments, first recipes (GitHub Actions, Argo CD)
   - **v0.3**: bugs linked to failed tests, UAT sign-offs and manual check results from the tools
     where testers work
   - **v0.4**: gate recipes (Kargo, CI step, GitHub deployment protection), CDEvents in/out
2. **Build signals**: unit tests, coverage, static analysis and SARIF as version context
3. **After production**: post-deploy checks, rollbacks and incidents linked to versions
4. **Where teams already look**: a [Backstage](https://backstage.io) plugin that shows, on the page
   of each component in the catalog, its environments and the verdict of its latest versions. It
   reads `/v1/health` and `/v1/verdict`, and an annotation in `catalog-info.yaml`, such as
   `kollaudo/component: api`, links the two catalogs

## Design decisions

Architecture decisions are recorded in [`docs/adr/`](docs/adr/README.md). The scope of each
milestone is in [`docs/milestones/`](docs/milestones/).

## Development

Requires Node.js 24 and Docker. The repository is a pnpm monorepo
(see [ADR 0011](docs/adr/0011-typescript-monorepo.md)).

```bash
corepack enable                                     # provides the pinned pnpm version
pnpm install
docker compose up -d                                # PostgreSQL for local development
cp apps/server/.env.example apps/server/.env
pnpm admin project create demo                      # prints an ingest and a read token
pnpm dev                                            # API on :8080, UI with hot reload on :5173
pnpm check && pnpm typecheck && pnpm test           # what CI runs
```

The end-to-end test runs Kollaudo in its container and uses it as a team would, with the CLI and
Playwright:

```bash
pnpm build
pnpm --filter @kollaudo/e2e exec playwright install chromium
docker compose --profile app up -d --build --wait
e2e/run.sh
```

`pnpm build` also builds the UI, which the server then serves on :8080 as in production.
`docker compose --profile app up -d --build` builds the container image from the sources and runs it
on :8080, with the same database.

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

---

<p align="center">
  <img src="https://github.com/user-attachments/assets/99cf0d17-3cd4-4d03-afb9-e5eba996528b" alt="Sonic shrugging: I don't know" width="280"><br>
  <sub>Kollaudo when your e2e tests are all green: <code>approved</code>.</sub>
</p>
