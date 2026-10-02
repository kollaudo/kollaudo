# Playwright with GitHub Actions

Run Playwright against staging, send the results to Kollaudo, and promote to production only if
the verdict passes. The steps are explained in [Sending test results](../sending-results.md).

Kollaudo tests itself this way: [`e2e/`](../../e2e/) is a Playwright project with this reporter
configuration, and [`e2e/run.sh`](../../e2e/run.sh) sends its report and checks the verdict.

## 1. Add the CTRF reporter

```bash
npm install --save-dev playwright-ctrf-json-reporter
```

In `playwright.config.ts`, next to your other reporters:

```ts
export default defineConfig({
  reporter: [
    ["list"],
    ["playwright-ctrf-json-reporter", { outputDir: "ctrf", outputFile: "ctrf-report.json" }],
  ],
  // …
});
```

Tests that pass after a retry are marked flaky in the report. They don't fail the verdict, and
Kollaudo shows them.

## 2. Configure the repository

In **Settings → Secrets and variables → Actions**:

- variable `KOLLAUDO_URL`: the URL of your Kollaudo;
- secret `KOLLAUDO_TOKEN`: an ingest token of your project, from
  `kollaudo-server project create <name>` or `kollaudo-server token create <name> --scope ingest`.

## 3. Send the results, then gate the promotion

```yaml
env:
  KOLLAUDO_URL: ${{ vars.KOLLAUDO_URL }}
  KOLLAUDO_TOKEN: ${{ secrets.KOLLAUDO_TOKEN }}
  # The version you deployed to staging: here the commit, or your image tag.
  VERSION: ${{ github.sha }}

jobs:
  e2e-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env:
          BASE_URL: https://staging.example.com
      - name: Send the results to Kollaudo
        if: ${{ !cancelled() }} # also when tests failed
        run: >-
          npx @kollaudo/cli push ctrf/ctrf-report.json
          --component frontend --env staging --version "$VERSION"
          --commit "$GITHUB_SHA" --branch "$GITHUB_REF_NAME"

  promote:
    needs: e2e-staging
    if: ${{ !cancelled() }} # the verdict decides, not the test job
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - name: Gate on the verdict of staging
        run: npx @kollaudo/cli verdict --component frontend --env staging --version "$VERSION" --require e2e
      - run: ./deploy.sh production "$VERSION"
```

The gate prints the verdict and a link to each run it used:

```
FAIL  frontend 3f2a9c1e8b7d4f60a1c2e3d4b5a69788f0e1d2c3 in staging: e2e failed.

  fail     e2e  1 failed, 41 passed, 2 flaky  https://kollaudo.example.com/test-runs/…
```

Because the gate requires `e2e`, tests that never reported, for example because the report step was
removed, make the verdict `unknown`, and the gate stops with exit code `2`. Without `--require e2e`,
a version with no e2e run but another kind of run could pass: keep the requirement in the gate. See [exit codes](../sending-results.md#3-gate-on-the-verdict)
to handle it differently.
