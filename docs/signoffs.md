# Sign-offs: evidence from people

A policy can ask for a person's word: a product owner who tries a version in `staging` and says it
is fine, or a tester who ran a manual check. A pipeline can't give it, because only a token of the
`signoff` scope can ([ADR 0021](adr/0021-signoff-as-a-test-run-with-its-own-scope.md)).

A sign-off is a test run of a kind, such as `uat` or `manual`, with one test and one outcome, `pass`
or `fail`. The verdict judges it like any other run: the latest one of a kind counts, and `maxAge`
and `deployed` apply. Manual checks with several cases are better sent as a report, as today.

## Who can sign off

Give the `signoff` scope to people, with a name that says who holds it, and limit it to what they
may sign off:

```bash
kollaudo-server token create shop --scope signoff --name product-owner \
  --component checkout --environment staging
```

Until Kollaudo has users, the name of the token is what the verdict shows as the author.

## Require a sign-off

List the kinds in `signoff` in the [policy](policies.md), next to `require`:

```yaml
environments:
  staging:
    require: [e2e, smoke]
    signoff: [uat]
```

- Without a sign-off, the verdict is `unknown`, and says that `uat` is waiting for one.
- A `uat` report sent by CI doesn't replace it: it is kept and shown, but the kind counts only from a
  run sent with a `signoff` token.
- A `fail` sign-off makes the verdict `fail`. A sign-off can be given again: the earlier one stays in
  the list, and the latest one counts.
- A kind in `signoff` needn't be in `require`. If it is in both, `signoff` wins.

Older servers reject a policy file with `signoff`: update the server before the policy.

## Give one

`POST /v1/signoffs`, with a `signoff` token:

```bash
curl -X POST "$KOLLAUDO_URL/v1/signoffs" \
  -H "Authorization: Bearer $KOLLAUDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"component": "checkout", "environment": "staging", "version": "3f2a9c1",
       "kind": "uat", "outcome": "pass",
       "note": "Checked the new payment page with the two test cards"}'
```

`GET /v1/signoffs` lists them, newest first, with `component`, `environment`, `version` and `kind`
to filter. A `signoff` or `read` token can read the list. The verdict names the author, the time and
the note in the reason of the kind, and `GET /v1/test-runs` shows a sign-off with `signoff: true`.

A `signoff` token can also ask `GET /v1/verdict`, to see what its sign-off led to.

A `kollaudo signoff` command, which prints that verdict, comes next.
