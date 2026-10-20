# Known bugs linked to failed tests

A failed test can say which bug it fails for, so that a `fail` tells a bug a team already knows from a
new one ([ADR 0022](adr/0022-known-bugs-linked-to-failed-tests.md)). This page covers how to send the
links and what the verdict does with them.

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

## What the verdict says

The verdict matches the tests that failed in the latest run of each kind with the open bugs of the
component. Each reason lists its `failures`, with the bug of each one or `null` when the failure is
new, and its message sums them up:

```
fail  e2e  2 failed: 1 known (SHOP-412), 1 new; 40 passed
```

```json
{
  "kind": "e2e",
  "outcome": "fail",
  "failures": [
    { "test": "checkout › applies a coupon", "bug": null },
    {
      "test": "checkout › pays with a saved card",
      "bug": { "key": "SHOP-412", "url": "https://example.atlassian.net/browse/SHOP-412", "state": "open" }
    }
  ]
}
```

- **A known bug never changes the outcome.** The run still fails, and so does the verdict. To let
  the version through, use an [override](overrides.md). The exit codes of `kollaudo verdict` stay as
  they are.
- Only an `open` bug marks a failure as known. When a bug is closed, a test that still fails is new
  again.
- A test that passed on a retry is flaky, not failed, and is not listed.
- `unmatchedBugs` lists the open bugs of the component whose test didn't fail in any run of the
  verdict. It is filled only when some test failed. A bug there may mean that the test was fixed, or
  renamed: send the link again with the new name.
- `kollaudo verdict --json` has all of it. Servers before 0.5 leave the fields out.

## List them

`GET /v1/bugs` lists the bugs, each with its tests, the last one sent first. It takes `component`,
`key` and `state` as filters, and accepts `read` and `ingest` tokens.

Update the server before the tools that send links: older servers have no `/v1/bugs`.
