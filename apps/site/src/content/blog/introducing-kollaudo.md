---
link: https://www.linkedin.com/posts/pamoda-angelo-konara_devops-platformengineering-kubernetes-activity-7512829208067518464-E_s9
title: "Your tests passed. Did they test the version you're about to ship to production?"
date: 2026-10-05
author: Pamoda Angelo K.
# The last frame of the video, as on LinkedIn: the first one is blank.
poster: ./images/introducing-kollaudo-poster.jpg
# The text of the post, so the blog shows it even when LinkedIn doesn't answer the build.
text: |
  Your tests passed. Did they test the version you're about to ship to production?

  I've been building something to answer that and today I'm sharing it for the first time.
  It's called Kollaudo. From the Italian collaudo, the final acceptance test before something goes into service.

  Kollaudo is a quality gate for every promotion. Before a version reaches production, or moves to any environment on the way, your pipeline asks it one question: is this version healthy here?

  The evidence to answer that question is usually scattered. E2E tests run in one pipeline, smoke tests after Argo CD syncs and the promotion happens in Kargo or yet another pipeline. Each tool knows its own piece. Nobody puts the pieces together before a release goes out.

  Kollaudo does. Your CI sends it the test results, from any framework, as JUnit XML or CTRF. Kollaudo judges them against rules your pipeline can't loosen and answers pass, fail or unknown. Your pipeline or Kargo does what the verdict says. And if a deployment goes around the gate, Kollaudo marks it.

  It doesn't build, test or deploy anything. It judges.

  It's open source (Apache-2.0) and self-hosted: one container plus PostgreSQL. v0.3 is out. It's young, and I'd rather hear what's wrong with it now than after 1.0. If your team ships through several environments, tell me how you decide today whether a version can move on and what would stop you from using Kollaudo.

  Want to contribute? There are good first issues, and if you use Flux, Argo Rollouts or Flagger, a recipe for your tool is very welcome.

  P.S. Kollaudo can tell you whether a version is healthy. It can't make Friday afternoon a good time to release. "Don't deploy on Fridays" still applies.

  Repo in the first comment 👇

  #DevOps #PlatformEngineering #Kubernetes #GitOps #OpenSource
---
