# Overrides: urgent fixes through the gate

When a fix has to go out now and the verdict can't pass in time, because the e2e environment is down
or a flaky test blocks it, an override lets **one version** through **one gate**, for a while. The
verdict passes, and says it was overridden, by whom, why and until when
([ADR 0018](adr/0018-overrides.md)).

Without overrides, teams go around a gate in a hurry: they edit the pipeline, or send a report that
says what the gate wants. An override keeps the gate in place, and leaves a record.

## Who can override

Overrides need a token of the `override` scope, which pipelines don't hold: a pipeline can't
override its own gate. Give it to the people on call, with a name that says who holds it:

```bash
kollaudo-server token create shop --scope override --name on-call
```

Until Kollaudo has users, the name of the token is what the verdict shows as the author.

## Let a version through

```bash
export KOLLAUDO_TOKEN=<override token>
kollaudo override --component api --env staging --version 3f2a9c1 \
  --reason "Hotfix for incident 1234, e2e environment down" --for 2h
```

- `--env` is the environment of the gate: to promote to production after staging, it's `staging`.
- `--reason` is required: it's what people read when they wonder why a version went through.
- `--for` is how long it holds: 4 hours unless given, 24 hours at most. It applies to that version
  only: the next one goes through the gate as usual.

The gate, unchanged, now passes, and its log says why:

```console
$ kollaudo verdict --component api --env staging --version 3f2a9c1 --require e2e
PASS (override)  api 3f2a9c1 in staging: Overridden by on-call until 2026-10-02T12:00:00.000Z: Hotfix for incident 1234, e2e environment down
The evidence alone is unknown.

  unknown  e2e  Required, but no run.
```

`GET /v1/verdict` returns the override in `override`, and the outcome the evidence alone gives in
`evidenceOutcome`.

## Review and revoke

```bash
kollaudo override list                 # every override, newest first, expired ones too
kollaudo override list --env staging
kollaudo override revoke <id>          # it stops holding now
```

Overrides are never deleted: they are the record of what went through without its evidence. If they
become frequent, they say something about the tests or the environments behind the gate.
