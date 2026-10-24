---
layout: ../layouts/Prose.astro
title: FAQ
description: Answers to the questions people ask about Kollaudo, its verdicts and how it fits in a delivery.
kicker: FAQ
heading: Frequently asked *questions*
lead: The short answers. Each one links to the page that says more.
---

## General questions

<details id="what-is-kollaudo">
<summary>What is Kollaudo?</summary>

A quality gate for every promotion. Your CI sends test results to Kollaudo, and before a version
moves on, from `dev` to `staging` or from `staging` to `production`, your pipeline, Kargo or Argo
Rollouts asks one question: *is this version healthy here?* Kollaudo answers **pass**, **fail** or
**unknown**.

</details>

<details id="where-does-the-name-come-from">
<summary>Where does the name come from?</summary>

*Collaudo* is Italian for the final acceptance test before something is put into service, like a
bridge before it opens to traffic.

</details>

<details id="so-it-runs-my-tests-or-deploys-my-software">
<summary>So it runs my tests? Or deploys my software?</summary>

Neither. There are plenty of great tools for that. Kollaudo collects their results and judges, and
the tool that promotes does what the verdict says ([ADR 0002](/docs/adr/0002-judge-never-orchestrate/)).
That's also why your deployments keep working when Kollaudo is down.

</details>

<details id="why-is-unknown-not-just-a-pass">
<summary>Why is "unknown" not just a pass?</summary>

Because a test that never reported proves nothing. If a kind of test your policy requires didn't
run for this version, the verdict is `unknown`, and a promotion stops, just as on `fail`. A missing
test run should block a release, not go unnoticed
([ADR 0013](/docs/adr/0013-verdict-pass-fail-unknown/)).

</details>

<details id="do-i-need-kollaudo">
<summary>Do I need Kollaudo?</summary>

It's for teams that ship several components through several environments, with tests at each step,
and want one answer before promoting a version. It helps most when your delivery is split across
tools: one CI builds, another runs e2e tests, Argo CD deploys, Kargo promotes.

If one CI system does all of this for you and its gates are enough, you probably don't need it.

</details>

<details id="is-kollaudo-open-source">
<summary>Is Kollaudo open source?</summary>

Yes, under the Apache-2.0 license, and self-hosted: your test results stay with you. The code is on
[GitHub](https://github.com/kollaudo/kollaudo).

</details>

<details id="is-it-ready-for-production">
<summary>Is it ready for production?</summary>

It's young. Version 0.5 is out, and the API can still change before 1.0. Feedback from your own
delivery is very welcome in [Issues](https://github.com/kollaudo/kollaudo/issues).

</details>

<details id="how-do-i-get-started">
<summary>How do I get started?</summary>

The [quick start](/#quick-start) gets you a first verdict in three commands, with Docker and Node.js.
Then [sending test results](/docs/sending-results/) shows how to do it from your own CI.

</details>

<details id="how-can-i-contribute">
<summary>How can I contribute?</summary>

Read [CONTRIBUTING.md](https://github.com/kollaudo/kollaudo/blob/main/CONTRIBUTING.md), and pick one
of the [good first issues](https://github.com/kollaudo/kollaudo/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
A recipe for the CI or tool you use is a great place to start.

</details>

## Technical questions

<details id="which-test-frameworks-does-it-work-with">
<summary>Which test frameworks does it work with?</summary>

Any framework that writes JUnit XML or [CTRF](https://ctrf.io), which is almost all of them.
`kollaudo push` sends the report, and converts JUnit XML to CTRF on the way
([ADR 0015](/docs/adr/0015-junit-converted-by-the-cli/)). The [Playwright](/docs/recipes/playwright/)
and [pytest](/docs/recipes/pytest/) recipes are complete examples.

</details>

<details id="which-ci-and-deployment-tools-does-it-work-with">
<summary>Which CI and deployment tools does it work with?</summary>

Any tool that can run a command or call an HTTP API. Each one has a recipe with a complete example:
[GitHub Actions](https://github.com/marketplace/actions/kollaudo-gate),
[GitLab CI](/docs/recipes/gitlab-ci/), [Azure DevOps](/docs/recipes/azure-devops/),
[Jenkins](/docs/recipes/jenkins/), [Argo CD](/docs/recipes/argocd/), [Kargo](/docs/recipes/kargo/),
[Argo Rollouts](/docs/recipes/argo-rollouts/) and [Flagger](/docs/recipes/flagger/). Support for a specific tool lives in a recipe, not
in the core ([ADR 0003](/docs/adr/0003-tool-agnostic-core/)).

</details>

<details id="how-does-a-pipeline-read-the-verdict">
<summary>How does a pipeline read the verdict?</summary>

From the exit code of `kollaudo verdict`: `0` pass, `1` fail, `2` unknown and `3` no verdict, when
Kollaudo didn't answer or the token or options are wrong. Any non-zero code stops the step.
`--json` adds the details for scripts, and never changes the code.

</details>

<details id="what-happens-when-kollaudo-is-down">
<summary>What happens when Kollaudo is down?</summary>

Nothing is deployed by Kollaudo, so nothing breaks. A gate that asks for a verdict gets no answer,
`kollaudo verdict` exits with `3`, and the gate decides whether to stop or go ahead. The recipes stop
([ADR 0019](/docs/adr/0019-when-the-gate-is-skipped-or-kollaudo-is-down/)), and an
[override](/docs/overrides/) lets an urgent fix through.

</details>

<details id="can-a-pipeline-make-its-own-gate-looser">
<summary>Can a pipeline make its own gate looser?</summary>

No. The rules live in a [policy](/docs/policies/) kept by Kollaudo: which kinds of test each
environment requires, whether tests count only on the deployed version, how flaky tests count and
how old a run can be. A pipeline can ask for more, never for less
([ADR 0016](/docs/adr/0016-rules-kept-by-kollaudo/)).

</details>

<details id="how-do-i-let-an-urgent-fix-through">
<summary>How do I let an urgent fix through?</summary>

With an [override](/docs/overrides/). It lets a version through the gate, and records who did it,
why and until when. The verdict still shows what the tests alone would say.

</details>

<details id="can-i-let-unknown-through-in-a-dev-environment">
<summary>Can I let unknown through in a dev environment?</summary>

Yes, explicitly. The [GitHub Action](https://github.com/kollaudo/action) has an `allow` input:
`allow: unknown`, `allow: no-verdict` or both, for development and preview environments. It's never
the default.

</details>

<details id="who-can-send-results">
<summary>Who can send results?</summary>

Anyone with an ingest token. Give each pipeline its own, with a name and limits on components and
environments, so it can only send what it's responsible for. The name shows up next to everything
the token sends, so a surprising verdict says where its evidence came from
([ADR 0017](/docs/adr/0017-trust-in-evidence/)).

</details>

<details id="can-a-person-sign-off-a-version">
<summary>Can a person sign off a version?</summary>

Yes. A policy can ask for a person's word, such as a product owner who tries a version in `staging`,
and only a token of the `signoff` scope can give it. Send it with `kollaudo signoff`. See
[sign-offs](/docs/signoffs/).

</details>

<details id="what-do-i-need-to-run-it">
<summary>What do I need to run it?</summary>

One container next to PostgreSQL. Use [Docker Compose](/#quick-start) to try it, or the Helm chart on
Kubernetes:

```bash
helm install kollaudo oci://ghcr.io/kollaudo/charts/kollaudo -n kollaudo \
  --set database.existingSecret=<secret with the database URI>
```

</details>
