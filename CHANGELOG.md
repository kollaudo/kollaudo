# Changelog

Notable changes of each release. The format follows [Keep a Changelog](https://keepachangelog.com),
and versions follow [Semantic Versioning](https://semver.org). Until 1.0, a minor version can break
the API.

## [Unreleased]

### Helm chart

- A Helm chart installs Kollaudo on Kubernetes, next to an existing PostgreSQL such as one from
  CloudNativePG. It is published with each release on `oci://ghcr.io/kollaudo/charts/kollaudo`.

### Server

- Policies ([ADR 0016](docs/adr/0016-rules-kept-by-kollaudo.md), [docs](docs/policies.md)): the
  rules of the verdict, kept by Kollaudo in revisions and sent with a `policy` token, for each
  environment and component. Required kinds, `deployed` (tests count only for the version that was
  deployed when they ran), `flaky` and `maxAge`. A request can add required kinds, never remove them.
  `POST /v1/policy`, `POST /v1/policy/check` and `GET /v1/policy`.
- The verdict says which policy revision and rules it applied.
- Overrides ([ADR 0018](docs/adr/0018-overrides.md), [docs](docs/overrides.md)): an `override`
  token lets one version through the gate of one environment, with a required reason, for up to 24
  hours. The verdict passes and says so, with the outcome of the evidence alone. Overrides are kept
  and listed with `GET /v1/overrides`, and can be revoked.
- Tokens can have a name, and `ingest` tokens can be limited to components and environments, by
  name or with `*` patterns ([ADR 0017](docs/adr/0017-trust-in-evidence.md)). Every test run and
  deployment records the token that sent it, shown in the API, the UI and the verdict.
- New token scopes `policy` and `override`, for the rules of the verdict and for overrides.
- Deployments: `POST /v1/deployments` records that a version runs in an environment, and
  `GET /v1/deployments` lists them. Components, environments and versions are created on first use,
  with the same rules as test runs.
- `/v1/health` lists what runs now in each environment, and the verdict reports it, without changing
  its outcome.
- Several instances can start together on the same database: they take turns to run the migrations.

### Web UI

- The health matrix shows the version that runs in each environment, marks test runs of another
  version, and shows deployed versions with no tests yet.

### Recipes

- [Argo CD](docs/recipes/argocd.md): a notification records a deployment in Kollaudo after each sync.
  Tested with Argo CD in a kind cluster.

### CLI

- `kollaudo policy push`, `check` and `show`.
- `kollaudo override`, `override list` and `override revoke`. `kollaudo verdict` prints
  `PASS (override)` with the reason, and the outcome of the evidence alone.
- `kollaudo deployed` records a deployment, after your deployment tool did it.
- `kollaudo verdict` notes when the environment runs another version than the one it judged, and
  says which token sent each run.

## [0.1.1] - 2026-10-01

Send JUnit XML from any test tool, as well as CTRF.

### CLI

- `kollaudo push` reads JUnit XML as well as CTRF, recognized by its content, and converts it to
  CTRF ([ADR 0015](docs/adr/0015-junit-converted-by-the-cli.md)). Retries of Maven Surefire and of
  Gradle's test-retry plugin become flaky tests.
- `kollaudo push` takes several files and glob patterns, and sends them as one test run.
- `--tool` names the tool that ran the tests.
- The npm package no longer lists `devDependencies` and build scripts, which pointed to the private
  `@kollaudo/schema` package.

## [0.1.0] - 2026-09-30

First release: send test results from any CI, gate promotions on the verdict, and see the health of
every component in every environment.

### Server

- One container with the API and the web UI, next to PostgreSQL. Migrations run on startup.
- Projects with `ingest` and `read` API tokens, managed with `kollaudo-server project` and
  `kollaudo-server token`.
- `POST /v1/test-runs` receives CTRF reports. Components, environments and versions are created on
  first use. Versions can carry their commit, branch, tag, pull request and artifact digest.
- `GET /v1/verdict`: `pass`, `fail` or `unknown` for a version in an environment, with the reasons,
  under the default policy. Missing evidence is never a pass.
- `GET /v1/test-runs`, `GET /v1/test-runs/{id}` and `GET /v1/health` to read results.
- OpenAPI document at `/v1/openapi.json`.

### CLI (`@kollaudo/cli`)

- `kollaudo push` sends a CTRF report.
- `kollaudo verdict` exits with `0` for pass, `1` for fail, `2` for unknown and `3` when there is no
  verdict.

### Web UI

- Health matrix of components and environments, test run pages, and several projects in one browser.

### Documentation

- [Sending test results](docs/sending-results.md) from any framework and CI, and a
  [Playwright recipe](docs/recipes/playwright.md).

[0.1.1]: https://github.com/kollaudo/kollaudo/releases/tag/v0.1.1
[0.1.0]: https://github.com/kollaudo/kollaudo/releases/tag/v0.1.0
