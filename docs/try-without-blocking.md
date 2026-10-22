# Try it without blocking anything

You can run Kollaudo next to your pipeline for a couple of weeks before it stops anything. The gate
asks for a verdict and records it, but the job goes on whatever the answer is. Afterwards the log
shows where your team decided differently from Kollaudo.

## 1. Ask for the verdict, and ignore it

Add the gate where it will go in the end, and make it unable to fail the job:

```bash
kollaudo verdict --component frontend --env staging --version "$VERSION" || true
```

In GitHub Actions put `continue-on-error: true` on the step of the [Kollaudo gate
action](sending-results.md#3-gate-on-the-verdict), and in the [GitLab CI recipe](recipes/gitlab-ci.md)
put `allow_failure: true` on the gate job. The verdict is computed and printed all the same, and every
one is [recorded](sending-results.md#every-verdict-is-recorded).
Send the test results with `kollaudo push` as you would for a real gate.

## 2. Tell Kollaudo what reaches production

Say where the versions of production come from, in a [policy](policies.md#deployments-that-skip-the-gate):

```yaml
environments:
  production:
    from: staging
```

Run `kollaudo policy push kollaudo.yaml` once. After each deployment to production, record it:

```bash
kollaudo deployed --component frontend --env production --version "$VERSION"
```

A version that went to production without a `pass` in staging is marked **ungated**, in the output
of `kollaudo deployed` and next to the version in the health matrix.

## 3. Look at the ungated versions

After the trial, open the health matrix, or list what was deployed and what was asked:

```bash
kollaudo deployed list --component frontend --env production
kollaudo verdict list --component frontend --env staging
```

Each ungated version is a conversation for the team: Kollaudo said `unknown` or `fail`, and the
version went out. Was Kollaudo right, or was the team? A version that failed in staging and still
reached production is the case that shows what a gate is for. When you are happy with the verdicts,
remove `|| true` and let the gate stop the job.
