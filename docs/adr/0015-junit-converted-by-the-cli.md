# 15. JUnit XML is converted to CTRF by the CLI

- Status: accepted
- Date: 2026-10-01

## Context

[0008](0008-ctrf-for-test-results.md) accepts JUnit XML next to CTRF, converted on ingest, without
saying where. Almost every test tool can write JUnit XML, but there is no specification: each tool
writes its own dialect. Maven Surefire nests reruns in a test case, Gradle writes each attempt as a
separate test case, pytest puts the class in `classname`, and timestamps rarely have a time zone.

The conversion could happen in the server, behind the HTTP API, or in the CLI, before sending.

## Decision

The CLI converts JUnit XML to CTRF, and sends CTRF. The HTTP API keeps one format.

- `kollaudo push` recognizes the format by the content of each file, not its name: JSON is CTRF, XML
  is JUnit.
- Several files and glob patterns are merged into one test run, because many tools write one file
  per suite. A push is one format: CTRF and JUnit files aren't mixed.
- The tool name, required by CTRF, comes from `--tool`, and is `junit` when it isn't given: JUnit
  files don't say reliably which tool wrote them.

The mapping, from each `<testcase>`:

| JUnit | CTRF |
|---|---|
| `name` | `name` |
| names of the enclosing `<testsuite>` elements, then `classname` when it differs from the innermost one | `suite` |
| `file`, when the tool writes it | `filePath` |
| `time`, in seconds | `duration`, in milliseconds |
| no child element | `passed` |
| `<failure>` or `<error>` | `failed`, with the `message` attribute as `message` and the text as `trace`. An error fails the run like a failure: the test didn't pass. A message that only repeats the status, such as `Failed` (go-junit-report), gives way to the first line of the text |
| `<skipped>` | `skipped`, with its message, or its text when the message only says `Skipped` |
| `<flakyFailure>` or `<flakyError>` (Maven Surefire), in a test case that passed | `passed`, `flaky`, and one retry per element |
| `<rerunFailure>` or `<rerunError>` (Maven Surefire), in a test case that failed | `failed`, and one retry per element |
| the same `classname` and `name` more than once (Gradle and others write one test case per attempt) | one test, with the status of the last attempt, `retries` for the others, and `flaky` when the last attempt passed after a failure |
| `<system-out>`, `<system-err>` | `stdout`, `stderr` |
| `<properties>` | `extra.junit.properties` |

The counts of the run are computed from the test cases. The `tests`, `failures` and `errors`
attributes of `<testsuite>` are ignored, since tools disagree on what they count. The start and end
of the run come from the `timestamp` of the suites only when it has a time zone. Otherwise they are
left out, and Kollaudo uses the time it received the run.

## Consequences

- Servers stay simple, and every format problem is fixed in the CLI, where it can be tested against
  files from many tools.
- Anything that calls the HTTP API directly, rather than the CLI, has to send CTRF: with a CTRF
  reporter, or by converting JUnit first, with the CLI or a tool such as `junit-to-ctrf`. If many
  integrations need JUnit over HTTP, the converter is a module of its own and can move to the server.
- The published CLI gets its first runtime dependency, an XML parser. Writing one would mean
  handling entities, CDATA and encodings by hand.
- A dialect that the mapping gets wrong needs a CLI release to fix. The tests keep real files from
  each tool, so a fix doesn't break the others.
