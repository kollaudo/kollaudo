---
link: https://www.linkedin.com/posts/pamoda-angelo-konara_devops-platformengineering-kubernetes-activity-7513553782438424576-pcXJ
title: "A test that never ran isn't a pass."
date: 2026-10-07
author: Pamoda Angelo K.
image: ./images/missing-evidence.jpg
# The text of the post, so the blog shows it even when LinkedIn doesn't answer the build.
text: |
  A test that never ran isn't a pass.

  Most release gates judge the results they receive. Nothing complains about the results that never arrive. A smoke job gets skipped, a runner is down, a webhook never fires and the gate stays green, because there's nothing red to see.

  In the example: checkout 9d07e6b in staging. The e2e failure is easy to spot. The line I care about is the next one: smoke, "Required, but no run."

  Kollaudo knows which kinds of tests each environment requires. If one of them never reported for that version, the answer is unknown and unknown blocks the promotion just like a failure. The command exits with 1 and the pipeline stops.

  Missing evidence isn't a pass. It's its own outcome.

  How does your team notice when a test suite silently didn't run?

  Repo in the comments 👇

  #DevOps #PlatformEngineering #Kubernetes #QA #OpenSource
---
