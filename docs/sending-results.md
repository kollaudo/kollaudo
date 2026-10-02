# Sending test results and gating on the verdict

Kollaudo works with any test framework and any CI. Whatever you use, there are three steps:

1. your tests write a report: [CTRF](https://ctrf.io) or JUnit XML;
2. `kollaudo push` sends it, saying which version of which component was tested, and where;
3. `kollaudo verdict` tells your pipeline whether that version can go on.

Kollaudo never runs your tests: it receives their results ([ADR 0002](adr/0002-judge-never-orchestrate.md)).
For a complete, working example, see the [recipes](#recipes).

## 1. Write a report

Kollaudo reads two formats. Use the one your tools already write.

**JUnit XML** is written by almost every test tool: Maven and Gradle with no setup, pytest with
`--junitxml`, Jest and Vitest with a reporter option, Go with `go-junit-report`, .NET with a JUnit
logger. If your CI already shows test results, as GitLab and Azure DevOps do, you probably have
these files. Point `kollaudo push` at them, and it converts them
([ADR 0015](adr/0015-junit-converted-by-the-cli.md)):

```bash
kollaudo push "target/surefire-reports/*.xml" --tool maven …   # Maven
kollaudo push "build/test-results/test/*.xml" --tool gradle …   # Gradle
kollaudo push junit.xml --tool pytest …                         # pytest --junitxml=junit.xml
```

Retries are understood too: Maven Surefire's reruns and Gradle's test-retry plugin show up as flaky
tests. `--tool` names the tool in Kollaudo, since JUnit files don't say which tool wrote them.

**[CTRF](https://ctrf.io)** is a JSON format with more detail, such as attachments and tags. Most
frameworks have a CTRF reporter: add it next to the reporters you already use.

| Framework | CTRF reporter | |
|---|---|---|
| Playwright | [`playwright-ctrf-json-reporter`](https://www.npmjs.com/package/playwright-ctrf-json-reporter) | [recipe](recipes/playwright.md) |
| Cypress | [`cypress-ctrf-json-reporter`](https://www.npmjs.com/package/cypress-ctrf-json-reporter) | |
| Jest | [`jest-ctrf-json-reporter`](https://www.npmjs.com/package/jest-ctrf-json-reporter) | |
| Vitest | [`vitest-ctrf-json-reporter`](https://www.npmjs.com/package/vitest-ctrf-json-reporter) | |
| Mocha | [`mocha-ctrf-json-reporter`](https://www.npmjs.com/package/mocha-ctrf-json-reporter) | |
| pytest | [`pytest-json-ctrf`](https://pypi.org/project/pytest-json-ctrf/): `pytest --ctrf ctrf-report.json` | |
| Go | [`go-ctrf-json-reporter`](https://github.com/ctrf-io/go-ctrf-json-reporter): `go test -json ./... \| go-ctrf-json-reporter -output ctrf-report.json` | |
| Anything else | see the [list of CTRF reporters](https://ctrf.io) | |

Whatever the format, several files make one test run: give them all to `kollaudo push`, or a glob
pattern in quotes. That's how the shards of a Playwright run, or the per-class files of Maven, are
sent together.

## 2. Send it with `kollaudo push`

The CLI needs Node.js 24. Run it with `npx @kollaudo/cli`, or install it with
`npm install -g @kollaudo/cli`.

```bash
export KOLLAUDO_URL=https://kollaudo.example.com
export KOLLAUDO_TOKEN=<an ingest token of your project>   # a secret of your CI

kollaudo push ctrf-report.json \
  --component frontend --env staging --version "$VERSION" --kind e2e \
  --commit "$COMMIT" --branch "$BRANCH"
```

- **`--component`**: what you build and ship, such as a service or an app.
- **`--env`**: where the tests ran against, such as `staging` or `pr-42`. Leave it out for tests of
  the code itself, such as unit tests: they are *build level*.
- **`--version`**: what identifies the build that was tested. Use the same value everywhere: in
  every environment, and in the gate. Good choices are the commit SHA, or the image tag you deploy.
  If you deploy container images, also send `--digest` with the image digest: Kollaudo then refuses
  results of a different image under the same version ([ADR 0005](adr/0005-create-on-first-use.md)).
- **`--kind`**: `e2e` by default. Use `smoke`, `uat`, `api`… to tell suites apart: the verdict
  judges each kind by its latest run.

Send the report **even when tests fail**. In most CI systems a failing test step stops the job,
so run `push` in a step that runs anyway (`if: ${{ !cancelled() }}` in GitHub Actions, `when: always`
in GitLab CI, `post { always { … } }` in Jenkins). `push` exits with `0` when Kollaudo stored the
report, whatever the results.

### Tell Kollaudo what runs where

After your deployment tool deployed a version, tell Kollaudo. It then shows which version runs in
each environment next to what was tested, and warns when the tests judged another version, or when
a deployed version has no tests yet:

```bash
kollaudo deployed --component frontend --env staging --version "$VERSION" --tool helm
```

With Argo CD, a notification does it for you after each sync: see the
[Argo CD recipe](recipes/argocd.md). Kollaudo never deploys anything: `deployed` records what your
tools did. Use the same ingest token
as `push`. `--at` gives the time it happened, when you report it later.

> `kollaudo deployed` comes with the next release, 0.2.0.

## 3. Gate on the verdict

Before promoting a version to the next environment, ask for its verdict in the environment it
comes from ([ADR 0013](adr/0013-verdict-pass-fail-unknown.md)):

```bash
kollaudo verdict --component frontend --env staging --version "$VERSION" --require e2e,smoke
```

| Exit code | Verdict | Meaning |
|---|---|---|
| `0` | pass | every kind of test that ran, and every required kind, passed |
| `1` | fail | the latest run of a kind has failed tests |
| `2` | unknown | evidence is missing: no run in that environment, or none of a required kind |
| `3` | none | Kollaudo can't be reached, or the token or options are wrong |

`--require` lists the kinds that must have run. Without it, a version whose smoke tests never
reported can still pass on its e2e tests alone ([ADR 0014](adr/0014-policy.md)).

### What the verdict checks today

These are the default rules, the same for every component and environment
([ADR 0013](adr/0013-verdict-pass-fail-unknown.md), [ADR 0014](adr/0014-policy.md)):

- Only test runs of **that version** in **that environment** count. Build-level runs, such as unit
  tests sent without `--env`, are shown but don't count.
- Each kind of test is judged by its **latest run**: a run after a fix replaces the one that failed.
- A run **fails** when one of its tests failed. Skipped tests don't fail it, and neither do flaky
  tests that passed after a retry.
- A run with **no tests** counts as missing.
- Every kind in `--require` must have a run. Without `--require`, only the kinds that ran are judged:
  the verdict is `unknown` when nothing ran at all, or when the latest run of a kind is empty.
- A run counts **however old** it is, and the deployed version doesn't change the outcome.

Rules for each component and environment, kept by Kollaudo so that a pipeline can't relax them, come
with 0.2.0: required kinds, whether the tested version must be the one that runs, and more.

The token can be the same ingest token you push with. Any step that fails on a non-zero exit code
is a gate. To let `unknown` through with a warning, or to go ahead when Kollaudo is down, say so:

```bash
code=0
kollaudo verdict --component frontend --env staging --version "$VERSION" || code=$?
case $code in
  0) ;;
  2) echo "No complete evidence for $VERSION on staging: promoting anyway." ;;
  *) exit "$code" ;;
esac
```

## Recipes

Complete examples for one framework and one CI. They are tested in Kollaudo's own CI.

| Recipe | |
|---|---|
| [Playwright with GitHub Actions](recipes/playwright.md) | tested by [`e2e/`](../e2e/) |
| [Argo CD notifications](recipes/argocd.md): deployments after each sync | tested in kind by [`e2e/kind/recipe-argocd.sh`](../e2e/kind/recipe-argocd.sh) |

Using another framework or CI? A recipe is one Markdown file: contributions are welcome.
