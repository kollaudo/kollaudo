# Sign off or link a bug with one command

A tester or a product owner can give a [sign-off](signoffs.md) or link a [bug](bugs.md) to a failed
test with one `curl` command. There is nothing to install: no CLI and no Node.js. Copy the command
of this page, replace the values and paste it in a terminal. Postman and Insomnia can import a
`curl` command too.

This page is for people who don't work in a pipeline. Until Kollaudo has users and the UI can take a
sign-off itself, it is the form. A tool that sends the same request for you, such as a Jira
automation rule, needs no `curl`: it sends the `POST` the commands below show.

## What you need

Two things from whoever runs Kollaudo:

- **The address** of Kollaudo, such as `https://kollaudo.example.com`.
- **A token.** A sign-off needs a token of the `signoff` scope and a bug link needs an `ingest`
  token. They are made with `kollaudo-server token create`
  (see [who can sign off](signoffs.md#who-can-sign-off)). The name of the token is what Kollaudo
  shows as your name. It may be limited to some components and environments.

Set them once in the terminal window you use. The token stays out of the commands below and out of
what you paste in a chat:

```bash
export KOLLAUDO_URL=https://kollaudo.example.com
export KOLLAUDO_TOKEN=<your token>
```

## Sign off a version

Replace the values in the command:

| Value | What to put |
|---|---|
| `component` | The part of the product you checked, such as `checkout` |
| `environment` | Where you checked it, such as `staging` |
| `version` | The version you checked, as the release or the build says, such as `3f2a9c1` |
| `kind` | What you did: `uat` or `manual`. Use the one your team's [policy](policies.md) asks for |
| `outcome` | `pass` if it is fine, `fail` if it isn't |
| `note` | What you checked or what is wrong, up to 1000 characters. It can be left out |

```bash
curl -X POST "$KOLLAUDO_URL/v1/signoffs" \
  -H "Authorization: Bearer $KOLLAUDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"component": "checkout", "environment": "staging", "version": "3f2a9c1",
       "kind": "uat", "outcome": "pass",
       "note": "Checked the new payment page with the two test cards"}'
```

Kollaudo answers with what it recorded and your name in `by`:

```json
{"id":"…","component":"checkout","environment":"staging","version":"3f2a9c1","kind":"uat","note":"Checked the new payment page with the two test cards","outcome":"pass","by":"product-owner","createdAt":"2026-10-20T10:00:00.000Z"}
```

If you find a problem, send the command again with `"outcome": "fail"` and a note that says what is
wrong. You can also change your mind: the latest sign-off of a kind counts. The earlier ones stay
in the list.

### See what it led to

This asks for the verdict of the version. `record=false` means that you are looking, so it doesn't
count as a gate asking:

```bash
curl "$KOLLAUDO_URL/v1/verdict?component=checkout&environment=staging&version=3f2a9c1&record=false" \
  -H "Authorization: Bearer $KOLLAUDO_TOKEN"
```

Its first lines say `"outcome": "pass"`, `"fail"` or `"unknown"`, with a `message` such as
`e2e, smoke and uat passed.`. The `reasons` have one entry for each kind, including yours.

## Link a bug to a failed test

When a test fails because of a bug that is already open in your tracker, link them with an `ingest`
token. The verdict then says that this failure is known. It still fails: a bug never lets a version
through ([bugs](bugs.md)).

| Value | What to put |
|---|---|
| `key` | The key of the bug in the tracker, such as `SHOP-412` |
| `url` | The address of the bug |
| `component` | The component of the test |
| `tests` | The tests that fail because of it, named as the report shows them: the suite and the name, joined by ` › ` |

```bash
curl -X POST "$KOLLAUDO_URL/v1/bugs" \
  -H "Authorization: Bearer $KOLLAUDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"key": "SHOP-412", "url": "https://example.atlassian.net/browse/SHOP-412",
       "component": "checkout", "tests": ["checkout › pays with a saved card"]}'
```

When the bug is closed, tell Kollaudo, so that the failure is new again if the test still fails.
The tests can be left out:

```bash
curl -X POST "$KOLLAUDO_URL/v1/bugs" \
  -H "Authorization: Bearer $KOLLAUDO_TOKEN" -H "Content-Type: application/json" \
  -d '{"key": "SHOP-412", "url": "https://example.atlassian.net/browse/SHOP-412",
       "component": "checkout", "state": "closed"}'
```

## On Windows

Windows PowerShell treats the quotes of the commands above in its own way. It also has a `curl`
that is another command. Put the body in a file and use `curl.exe`:

```powershell
curl.exe -X POST "$env:KOLLAUDO_URL/v1/signoffs" `
  -H "Authorization: Bearer $env:KOLLAUDO_TOKEN" -H "Content-Type: application/json" `
  --data-binary "@signoff.json"
```

and set the two values with `$env:KOLLAUDO_URL = "…"` and `$env:KOLLAUDO_TOKEN = "…"`. `signoff.json`
holds the JSON of the `-d` option, as it is shown above. The same works in a terminal of macOS or
Linux, in place of `-d '…'`.

## If it doesn't work

`curl` prints Kollaudo's answer. Its `error.message` says what to change:

| Answer | What to check |
|---|---|
| `401 unauthorized` | The token is missing or wrong. Check `KOLLAUDO_TOKEN`: it is the token alone, with no `Bearer` |
| `403 forbidden` | The token is of the wrong scope: a sign-off needs `signoff` and a bug link needs `ingest` |
| `403 outside_token_limits` | The token is limited to other components or environments. Ask for a token that includes this one |
| `400 invalid_request` | A value is missing or wrong. The `issues` list each one with its name, such as `outcome` |
| Nothing comes back, or a web page | `KOLLAUDO_URL` is wrong. It is the address of Kollaudo, without a path |
