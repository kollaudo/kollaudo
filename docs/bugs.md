# Known bugs linked to failed tests

A failed test can say which bug it fails for, so that a `fail` tells a bug a team already knows from a
new one ([ADR 0022](adr/0022-known-bugs-linked-to-failed-tests.md)). This page covers how to send the
links. The verdict does not use them yet.

A link ties one bug to one test of one component. It holds for every version and environment until
its bug is closed, because a bug outlives the run that found it. A known bug never changes the
verdict: letting a version through is what an [override](overrides.md) is for.

## Name the test as the report does

A test is named by its suite and its name, joined by ` › `, as a tester reads it in a report:

```
checkout › pays with a saved card
```

The file is not part of the name. If a test is renamed, its link no longer matches until it is sent
again.

## Link a bug

Send the bug with an `ingest` token. The limits of the token to components apply, and its name is
recorded as the author.

```bash
curl -X POST "$KOLLAUDO_URL/v1/bugs" \
  -H "Authorization: Bearer $KOLLAUDO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "SHOP-412",
    "url": "https://example.atlassian.net/browse/SHOP-412",
    "component": "checkout",
    "tests": ["checkout › pays with a saved card"]
  }'
```

- A link is made for each test, and a link that exists is updated. The other links of the bug stay.
- The `url` follows the bug: every link of the key takes the one you send last.
- The `state` is `open` unless you say otherwise. An open bug needs at least one test.

## Close a bug

Send the key again with `"state": "closed"`. It closes every link of the bug in that component, so
the tests can be left out. Sending the bug as `open` again opens the links you name.

Kollaudo never reads the tracker: if the request is lost, the link stays open until it is sent again.

## List them

`GET /v1/bugs` lists the bugs, each with its tests, the last one sent first. It takes `component`,
`key` and `state` as filters, and accepts `read` and `ingest` tokens.

Update the server before the tools that send links: older servers have no `/v1/bugs`.
