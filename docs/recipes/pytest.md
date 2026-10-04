# pytest with GitHub Actions

Write a JUnit XML report with pytest, send it to Kollaudo, and gate a staging promotion on
the verdict. See [Sending test results](../sending-results.md) for tokens and exit codes.

## 1. Write the report

No reporting plugin is needed for JUnit XML:

```bash
pytest --junitxml=junit.xml
```

Alternatively, install `pytest-json-ctrf` and run `pytest --ctrf ctrf-report.json` for CTRF.
The CLI reads either format; `--tool pytest` identifies the producer of a JUnit report.
The repository tests the parser with a [real pytest report](../../packages/cli/src/testdata/junit/pytest.xml).

## 2. Send unit or environment-level results

Install `@kollaudo/cli` with Node.js 24 or newer, then configure `KOLLAUDO_URL` and an
ingest `KOLLAUDO_TOKEN`. Keep tokens in your CI secret store.

Unit tests belong to the build, not a deployed environment:

```bash
kollaudo push junit.xml --tool pytest --component api --version "$VERSION" --kind unit
```

Tests against staging include the environment:

```bash
kollaudo push junit.xml --tool pytest --component api --version "$VERSION" --env staging --kind e2e
```

Send the report even when pytest fails. `push` returning zero means the report was stored,
not that the tests passed. Build-level unit results are shown in Kollaudo but **do not count
towards the staging verdict**; do not gate them with `--env staging --require unit`.

Retries need evidence in the report. Kollaudo marks a test flaky when its report preserves a
failed attempt followed by a pass, or supplies CTRF `flaky`/`retries` fields. However, plain
pytest JUnit output can keep only the final outcome after `pytest-rerunfailures`: even the
checked-in fixture's `test_flaky_search` is parsed as an ordinary pass. Enabling retries
alone does not guarantee a flaky marker; check the reporter's output before relying on it.

## 3. Gate a staging promotion

The example assumes staging already runs `$VERSION` and your pytest suite targets it
through `BASE_URL`. Adjust that variable to your test project's configuration. Store
`KOLLAUDO_URL` as a repository variable and `KOLLAUDO_TOKEN` as a secret.

```yaml
env:
  KOLLAUDO_URL: ${{ vars.KOLLAUDO_URL }}
  KOLLAUDO_TOKEN: ${{ secrets.KOLLAUDO_TOKEN }}
  VERSION: ${{ github.sha }}

jobs:
  test-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.12"
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: python -m pip install -r requirements.txt pytest
      - run: npm install --global @kollaudo/cli
      - run: pytest --junitxml=junit.xml
        env:
          BASE_URL: https://staging.example.com
      - name: Send the results even when tests fail
        if: ${{ !cancelled() }}
        run: >-
          kollaudo push junit.xml --tool pytest
          --component api --version "$VERSION" --env staging --kind e2e

  promote:
    needs: test-staging
    if: ${{ !cancelled() }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm install --global @kollaudo/cli
      - run: kollaudo verdict --component api --env staging --version "$VERSION" --require e2e
      - run: ./deploy.sh production "$VERSION"
```

The promotion job asks for the verdict even if pytest failed. `--require e2e` also prevents
a missing report from being mistaken for a pass. Verdict exits are `0` (pass), `1` (fail),
`2` (unknown evidence), and `3` (connection, token or option error). Policies can impose
additional requirements; keep the same component, environment and version throughout.
