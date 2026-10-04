# GitLab CI

Run tests against staging, send the results to Kollaudo, and promote to production only if
the verdict passes. The steps are explained in [Sending test results](../sending-results.md).

## 1. Write a report

Kollaudo reads both CTRF reports (JSON) and JUnit XML ([ADR 0015](../adr/0015-junit-converted-by-the-cli.md)).
Use the format your test runner already produces.

For a Python service tested with pytest:
- list `pytest` and your test dependencies in `requirements-test.txt`;
- place end-to-end tests targeting staging in `tests/e2e` using `BASE_URL` (keep unit tests separate to avoid mislabelling unit results as e2e);
- run `pytest tests/e2e --junitxml=junit.xml` to write a JUnit report.

GitLab CI natively parses JUnit reports into merge request and pipeline widgets via
`artifacts:reports:junit`.

## 2. Configure CI/CD variables

In **Settings → CI/CD → Variables**:

- variable `KOLLAUDO_URL`: the URL of your Kollaudo instance (Masked);
- variable `KOLLAUDO_TOKEN`: an ingest token of your project (Masked), from
  `kollaudo-server project create <name>` or `kollaudo-server token create <name> --scope ingest`.
- variable `KOLLAUDO_READ_TOKEN`: a separate read token (Masked and Protected), used only by
  the promotion gate.

For token variables, clear **Expand variable reference**. GitLab accepts the `_` and `-`
characters in Kollaudo tokens as [masked variable values](https://docs.gitlab.com/ci/variables/#mask-a-cicd-variable).
When creating a token variable, you can choose **Masked and hidden** to also prevent revealing
its value in the settings UI; this uses the same masking requirements.

Give the pipeline an ingest token limited to the component and environment it tests ([ADR 0017](../adr/0017-trust-in-evidence.md)):

```bash
kollaudo-server token create shop --scope ingest --name gitlab-ci \
  --component api --environment staging
```

Create a separate token for the gate:

```bash
kollaudo-server token create shop --scope read --name gitlab-gate
```

Store it as `KOLLAUDO_READ_TOKEN`. The gate can read verdicts but cannot send results, and the
verdict log identifies it as `gitlab-gate`.

Deployment credentials for production (such as cloud tokens or SSH keys used by `./deploy.sh`)
must be configured separately as protected variables, restricted to protected branches, and kept
isolated from the Kollaudo ingest token.

## 3. Send the results, then gate the promotion

Add `.gitlab-ci.yml` to your repository:

```yaml
stages:
  - test
  - report
  - promote

test-staging:
  stage: test
  image: python:3.12-slim
  variables:
    BASE_URL: https://staging.example.com
  script:
    - pip install -r requirements-test.txt
    - pytest tests/e2e --junitxml=junit.xml
  artifacts:
    when: always
    paths:
      - junit.xml
    reports:
      junit: junit.xml

send-results:
  stage: report
  image: node:24-slim
  when: always
  dependencies:
    - test-staging
  script:
    - npx --yes @kollaudo/cli@0.2.0 push junit.xml --tool pytest --component api --env staging --kind e2e --version "$CI_COMMIT_SHORT_SHA"

promote:
  stage: promote
  image: node:24-slim
  dependencies: []
  rules:
    - if: $CI_COMMIT_REF_PROTECTED == "true"
      when: always
  script:
    - export KOLLAUDO_TOKEN="$KOLLAUDO_READ_TOKEN"
    - npx --yes @kollaudo/cli@0.2.0 verdict --component api --env staging --version "$CI_COMMIT_SHORT_SHA" --require e2e
    - ./deploy.sh production "$CI_COMMIT_SHORT_SHA"
```

The gate prints the verdict and a link to each run it used:

```
FAIL  api 3f2a9c1 in staging: e2e failed.

  fail     e2e  1 failed, 41 passed  https://kollaudo.example.com/test-runs/…
```

Because the gate requires `e2e`, tests that never reported make the verdict `unknown`, and the gate
stops with exit code `2`. Without `--require e2e`, a version with no e2e run could pass: keep the
requirement in the gate. See [exit codes](../sending-results.md#3-gate-on-the-verdict) to handle it
differently.

### How the stages work together

- **`test-staging`** runs your test suite against staging. If tests fail, the job exits with a
  non-zero code and retains that failed status in the pipeline. Its `artifacts: when: always` ensures
  `junit.xml` is saved and uploaded whenever pytest produces the file. If the job fails before
  generating the report (such as a setup failure in `pip install` or job cancellation), no artifact is
  created.
- **`send-results`** runs in the `report` stage with `when: always`, so it executes even if tests
  failed in `test-staging`. By specifying `dependencies: [test-staging]`, it fetches the report artifact
  and sends it to Kollaudo using the pinned CLI. `push` exits with `0` when Kollaudo stores the report.
  If no report artifact exists because the test job crashed early, `send-results` fails.
- **`promote`** runs on protected branches (`$CI_COMMIT_REF_PROTECTED == "true"`) with `when: always`,
  even if earlier jobs failed. It uses the separate read token to ask Kollaudo for the verdict before
  executing `./deploy.sh`: the verdict decides whether deployment proceeds. This allows a valid
  on-call override or policy decision to pass even when the test job failed.
- A non-zero verdict exit code (such as `1` for a failing verdict, `2` for missing required evidence,
  or `3` for connectivity or token errors) aborts the script immediately, blocking production
  deployment. The gate still requires `e2e` evidence for the same commit; it does not bypass Kollaudo.
- `dependencies: []` in `promote` prevents downloading unneeded test report artifacts from earlier
  stages.
