# Changelog

Notable changes of each release. The format follows [Keep a Changelog](https://keepachangelog.com),
and versions follow [Semantic Versioning](https://semver.org). Until 1.0, a minor version can break
the API.

## [Unreleased]

### Helm chart

- A Helm chart installs Kollaudo on Kubernetes, next to an existing PostgreSQL such as one from
  CloudNativePG. It is published with each release on `oci://ghcr.io/kollaudo/charts/kollaudo`.

### Server

- Several instances can start together on the same database: they take turns to run the migrations.

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
