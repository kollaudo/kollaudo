---
link: https://www.linkedin.com/posts/pamoda-angelo-konara_devops-sre-platformengineering-activity-7514293838199508992-RYDJ
title: "\"Don't deploy on Fridays.\" Incidents never read that rule."
date: 2026-10-09
author: Pamoda Angelo K.
image: ./images/urgent-fix.jpg
# The text of the post, so the blog shows it even when LinkedIn doesn't answer the build.
text: |
  "Don't deploy on Fridays." Incidents never read that rule.

  Production is down. The fix is ready. The gate says no, because the e2e environment is down too, so the tests the gate requires never ran.

  What usually happens next: someone edits the pipeline, comments out the check, or pushes a result that says what the gate wants to hear. The fix goes out. Two weeks later nobody remembers the gate was bypassed, or that it still is.

  In Kollaudo an urgent fix goes through an override instead:
  → one version, one gate, for a limited time (24 hours at most)
  → a reason is required
  → it needs its own token, which pipelines don't hold, so a pipeline can't override its own gate
  → the verdict says PASS (override), by whom, why, until when, and what the evidence alone said

  Overrides are never deleted. If they become frequent, that tells you something about your tests or your environments.

  The gate stays in place. You just leave a record.

  When your team bypasses a quality gate, where does that decision get written down?

  Repo in the comments 👇

  #DevOps #SRE #PlatformEngineering #Kubernetes #OpenSource
---
