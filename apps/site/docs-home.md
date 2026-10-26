---
title: Documentation
description: Guides, recipes and design decisions for Kollaudo.
---

Kollaudo gives a **pass**, **fail** or **unknown** verdict on a version of a component in an
environment. Your CI sends it test results and deployments, and a gate in your pipeline asks for the
verdict before going on.

New here? [Send test results and gate on the verdict](/docs/sending-results/) takes a few minutes.

## Guides

- [Sending test results and gating on the verdict](/docs/sending-results/): any framework, any CI.
- [Policies](/docs/policies/): what each environment requires.
- [Overrides](/docs/overrides/): let an urgent fix through, on the record.
- [Sign-offs](/docs/signoffs/): evidence from people.

## Recipes

One page for each CI or tool: [Playwright](/docs/recipes/playwright/),
[pytest](/docs/recipes/pytest/), [GitLab CI](/docs/recipes/gitlab-ci/),
[Azure DevOps](/docs/recipes/azure-devops/), [Jenkins](/docs/recipes/jenkins/),
[Argo CD](/docs/recipes/argocd/), [Kargo](/docs/recipes/kargo/),
[Argo Rollouts](/docs/recipes/argo-rollouts/) and [Flagger](/docs/recipes/flagger/).

## Why it works this way

The [decision records](/docs/adr/) explain the choices behind Kollaudo, such as why it judges and
never orchestrates.
