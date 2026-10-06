# Azure DevOps

Run unit tests on the build, deploy to staging, run end-to-end tests there, and deploy to production
only if Kollaudo's verdict for staging passes. The steps are explained in
[Sending test results](../sending-results.md).

The recipe has run on a real Azure DevOps pipeline, with a self-hosted agent: a passing version went
to production, and the gate stopped a version with a failed e2e test, and a version Kollaudo couldn't
be asked about.

## 1. Write reports

Kollaudo reads JUnit XML as well as CTRF reports ([ADR 0015](../adr/0015-junit-converted-by-the-cli.md)),
and most test tools on Azure DevOps already write JUnit for the `PublishTestResults` task: send the
same file to Kollaudo. Keep unit tests and end-to-end tests in separate reports, as they count in
different places.

## 2. Tokens and pipeline variables

Create two tokens: an `ingest` token limited to the component, for the steps that send results and
deployments, and a `read` token for the gate, so that Kollaudo's log of verdicts says which gate
asked ([ADR 0017](../adr/0017-trust-in-evidence.md)):

```bash
kollaudo-server token create shop --scope ingest --name azure-pipelines --component api --build \
  --environment staging --environment production
kollaudo-server token create shop --scope read --name azure-gate
```

In the pipeline, **Edit → Variables**, add `KOLLAUDO_TOKEN` and `KOLLAUDO_GATE_TOKEN`, each with
**Keep this value secret**, or put them in a variable group. Azure Pipelines doesn't pass secret
variables to scripts by itself: each step that needs one maps it with `env:`, as below.

## 3. The pipeline

`azure-pipelines.yml`:

```yaml
trigger: [main]

pool:
  vmImage: ubuntu-latest

variables:
  KOLLAUDO_URL: https://kollaudo.example.com
  KOLLAUDO_CLI: "@kollaudo/cli@0.3.0"
  # The version: the commit here, the same in every stage. An image tag works too.
  VERSION: $(Build.SourceVersion)

stages:
  - stage: Build
    jobs:
      - job: unit
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: "24.x"
          - script: npm ci && npm test
            displayName: Unit tests
          - task: PublishTestResults@2
            condition: succeededOrFailed()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: junit-unit.xml
          # Build-level results, without --env: shown in Kollaudo, they don't count for staging.
          - script: >-
              npx --yes $(KOLLAUDO_CLI) push junit-unit.xml
              --component api --version $(VERSION) --kind unit
              --commit $(Build.SourceVersion) --branch $(Build.SourceBranchName)
            displayName: Send the unit tests to Kollaudo
            condition: succeededOrFailed()
            env:
              KOLLAUDO_TOKEN: $(KOLLAUDO_TOKEN)

  - stage: Staging
    dependsOn: Build
    jobs:
      - job: deploy
        steps:
          - script: ./deploy.sh staging $(VERSION)
            displayName: Deploy to staging
          - script: >-
              npx --yes $(KOLLAUDO_CLI) deployed
              --component api --env staging --version $(VERSION) --tool azure-pipelines
            displayName: Tell Kollaudo what runs in staging
            env:
              KOLLAUDO_TOKEN: $(KOLLAUDO_TOKEN)

      - job: e2e
        dependsOn: deploy
        steps:
          - task: NodeTool@0
            inputs:
              versionSpec: "24.x"
          - script: npm ci && npm run e2e
            displayName: E2E tests against staging
            env:
              BASE_URL: https://staging.example.com
          - task: PublishTestResults@2
            condition: succeededOrFailed()
            inputs:
              testResultsFormat: JUnit
              testResultsFiles: junit-e2e.xml
          # Also when tests failed: the gate must see them.
          - script: >-
              npx --yes $(KOLLAUDO_CLI) push junit-e2e.xml
              --component api --env staging --version $(VERSION) --kind e2e
            displayName: Send the e2e tests to Kollaudo
            condition: succeededOrFailed()
            env:
              KOLLAUDO_TOKEN: $(KOLLAUDO_TOKEN)

  # The verdict decides, not the test job: the gate runs even when the e2e tests failed, so that an
  # override in Kollaudo can let a version through.
  - stage: Gate
    dependsOn: Staging
    condition: not(canceled())
    jobs:
      - job: verdict
        steps:
          - checkout: none
          - task: NodeTool@0
            inputs:
              versionSpec: "24.x"
          - script: >-
              npx --yes $(KOLLAUDO_CLI) verdict
              --component api --env staging --version $(VERSION) --require e2e
            displayName: Ask Kollaudo for the verdict of staging
            env:
              KOLLAUDO_TOKEN: $(KOLLAUDO_GATE_TOKEN)

  - stage: Production
    dependsOn: Gate
    jobs:
      - job: deploy
        steps:
          - script: ./deploy.sh production $(VERSION)
            displayName: Deploy to production
          - script: >-
              npx --yes $(KOLLAUDO_CLI) deployed
              --component api --env production --version $(VERSION) --tool azure-pipelines
            displayName: Tell Kollaudo what runs in production
            env:
              KOLLAUDO_TOKEN: $(KOLLAUDO_TOKEN)
```

The gate prints the verdict and a link to each run it used:

```text
PASS  api 3f2a9c1e… in staging: e2e passed.

  pass     e2e  2 passed  by azure-pipelines  https://kollaudo.example.com/test-runs/…
```

## How the stages work together

- **Build** runs the unit tests. `PublishTestResults` shows them in Azure DevOps, and the next step
  sends the same report to Kollaudo, even when tests failed (`condition: succeededOrFailed()`).
- **Staging** deploys, tells Kollaudo with `kollaudo deployed`, then runs the e2e tests against
  staging and sends them. A failed test fails the stage, and its results still reach Kollaudo.
- **Gate** runs unless the run was canceled, even after failed tests: `kollaudo verdict` decides. It
  exits with `0` on `pass`, which lets the pipeline go on; `1` on `fail`, `2` when evidence is
  missing, such as e2e tests that never reported, and `3` when Kollaudo can't be asked. Any of them
  fails the stage.
- **Production** depends on the gate with the default condition, so it runs only when the gate
  passed.

`--require e2e` turns a missing e2e report into `unknown`, which stops the gate. Policies kept in
Kollaudo can require more, and the pipeline can't relax them ([policies](../policies.md)).

## Agents

- **Microsoft-hosted agents** need to reach Kollaudo over the network: `KOLLAUDO_URL` must be an
  address they can reach, and new organizations have to
  [request free parallel jobs](https://aka.ms/azpipelines-parallelism-request) first.
- **Self-hosted agents**, such as one in the same network as Kollaudo, use `pool: <your pool>`
  instead of `vmImage`. They need Node.js 24 or later for the CLI; `NodeTool` installs it when
  missing.
