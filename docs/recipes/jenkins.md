# Jenkins

Run tests against staging, send the results to Kollaudo, and deploy to production only if the
verdict passes. The steps are explained in [Sending test results](../sending-results.md).

## 1. Write a report

Kollaudo reads JUnit XML as well as CTRF reports ([ADR 0015](../adr/0015-junit-converted-by-the-cli.md)).
Most test tools used with Jenkins already write JUnit for the `junit` step: send the same file to
Kollaudo. This recipe runs `npm run e2e`, which tests staging at `BASE_URL` and writes
`junit-e2e.xml`. Keep end-to-end tests in their own report, apart from unit tests.

## 2. Tokens and credentials

Create two tokens: an `ingest` token limited to the component and environment the pipeline tests,
and a `read` token for the gate, so that Kollaudo's log of verdicts says which gate asked
([ADR 0017](../adr/0017-trust-in-evidence.md)):

```bash
kollaudo-server token create shop --scope ingest --name jenkins \
  --component api --environment staging
kollaudo-server token create shop --scope read --name jenkins-gate
```

In **Manage Jenkins → Credentials**, add each one as a **Secret text** credential, with the IDs
`kollaudo-ingest-token` and `kollaudo-gate-token`. The `Jenkinsfile` binds each token with
`withCredentials` only in the step that uses it, so the gate never holds the ingest token.

Keep `KOLLAUDO_URL` as a plain value, in the `Jenkinsfile` or in a global environment variable.
Jenkins hides the value of a bound credential wherever it appears in the log, so a URL kept as a
secret would turn the links the gate prints into `****/test-runs/…`.

Credentials for the production deployment, such as cloud tokens or SSH keys used by `./deploy.sh`,
are separate from the Kollaudo tokens.

## 3. The pipeline

`Jenkinsfile`, in a Pipeline or Multibranch Pipeline job that reads it from your repository:

```groovy
pipeline {
  agent any

  environment {
    KOLLAUDO_URL = 'https://kollaudo.example.com'
    KOLLAUDO_CLI = '@kollaudo/cli@0.3.0'
    // The version: the commit here, the same in every stage. An image tag works too.
    VERSION = "${env.GIT_COMMIT}"
  }

  stages {
    stage('Test staging') {
      environment {
        BASE_URL = 'https://staging.example.com'
      }
      steps {
        // Jenkins keeps the workspace between builds: a report left by an earlier build must not be
        // sent for this version.
        sh 'rm -f junit-e2e.xml'
        // A failed test marks the stage, but the pipeline goes on to the gate: the verdict decides.
        catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
          sh 'npm ci && npm run e2e'
        }
      }
      post {
        always {
          junit testResults: 'junit-e2e.xml', allowEmptyResults: true
          // Also when tests failed: the gate must see them.
          withCredentials([string(credentialsId: 'kollaudo-ingest-token', variable: 'KOLLAUDO_TOKEN')]) {
            sh 'npx --yes "$KOLLAUDO_CLI" push junit-e2e.xml --component api --env staging --version "$VERSION" --kind e2e'
          }
        }
      }
    }

    stage('Gate') {
      steps {
        withCredentials([string(credentialsId: 'kollaudo-gate-token', variable: 'KOLLAUDO_TOKEN')]) {
          sh 'npx --yes "$KOLLAUDO_CLI" verdict --component api --env staging --version "$VERSION" --require e2e'
        }
      }
    }

    stage('Deploy to production') {
      steps {
        sh './deploy.sh production "$VERSION"'
      }
    }
  }
}
```

The gate prints the verdict and a link to each run it used:

```text
FAIL  api 3f2a9c1e… in staging: e2e failed.

  fail     e2e  1 failed, 41 passed  by jenkins  https://kollaudo.example.com/test-runs/…
```

## How the stages work together

- **Test staging** first removes the report of an earlier build: Jenkins keeps the workspace, and
  without it a run that crashed before writing a report would send the last one, possibly a passing
  one, for the new version. When a test fails, `catchError` marks the stage as failed and the build
  as unstable, and the pipeline goes on. In `post { always { … } }`, `junit` shows the report in
  Jenkins and `kollaudo push` sends the same file to Kollaudo. `push` exits with `0` when Kollaudo
  stores the report, even if tests failed. If the tests crashed before writing the report, `push`
  fails, and the build stops before the gate.
- **Gate** asks Kollaudo for the verdict of the same version with the read token. It exits with `0`
  on `pass`, which lets the pipeline go on; `1` on `fail`, `2` when evidence is missing, such as e2e
  tests that never reported, and `3` when Kollaudo can't be asked. Any of them fails the build and
  skips the deployment.
- **Deploy to production** runs only after a passing gate. An override in Kollaudo, or a policy, can
  let a version through even when a test failed: the build then stays unstable, and the deployment
  runs.

`--require e2e` turns a missing e2e report into `unknown`, which stops the gate. Policies kept in
Kollaudo can require more, and the pipeline can't relax them ([policies](../policies.md)).

## Agents

- The agent needs Node.js 24 or later for the CLI, and must reach `KOLLAUDO_URL` over the network.
  The [NodeJS plugin](https://plugins.jenkins.io/nodejs/) can install it with
  `tools { nodejs '<name>' }`, and the Docker Pipeline plugin can run the pipeline in a container
  with `agent { docker { image 'node:24' } }`.
- The `catchError`, `junit` and `withCredentials` steps come from the Pipeline, JUnit and
  Credentials Binding plugins.
- `GIT_COMMIT` is set when Jenkins checks out the repository for the pipeline. In a job with an
  inline script, set `VERSION` to the commit or image tag you test.
