import { parseArgs } from "node:util";
import type { Bug, BugInput, BugList } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const BUG_HELP = `Usage: kollaudo bug link <key> --component <name> --url <url> --test <name> [--test <name> ...] [--json]
       kollaudo bug close <key> --component <name> --url <url> [--json]
       kollaudo bug list [--component <name>] [--key <key>] [--state <state>] [--json]

Link a failed test to a known bug in your tracker, close it, or list the bugs, so that a verdict
says which failures are known and which are new. A known bug never changes the verdict: it still
fails, and letting a version through is what an override is for.

Commands:
  link    Link one or more tests to a bug, open by default
  close   Close every link of a bug in a component
  list    List the bugs, newest first, with the tests each one is linked to

Options:
  --component <name>     Component, such as "checkout" (required for link and close)
  --key <key>            Key of the bug in the tracker, such as "SHOP-412" (a filter for list)
  --url <url>            Address of the bug, such as "https://..." (required for link and close)
  --test <name>          A test that fails because of the bug, named as the report shows it: the
                         suite and the name, joined by " › ". Give it once per test (link only)
  --state <state>        With list: only open or closed
  --json                 Print the API's answer as JSON instead of the formatted output
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  An ingest token of your project to link or close (required).
                  A read or ingest token can list the bugs too

Example:
  kollaudo bug link SHOP-412 --component checkout \\
    --url https://example.atlassian.net/browse/SHOP-412 \\
    --test "checkout › pays with a saved card"
`;

const TIMEOUT_MS = 30_000;

export async function bug(args: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${BUG_HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(BUG_HELP);
    return 0;
  }

  const [action, key, ...rest] = positionals;
  if (action === "list" && !key && rest.length === 0) return list(values, io);
  if (action === "link" && rest.length === 0) return link(key, values, io);
  if (action === "close" && rest.length === 0) return close(key, values, io);

  io.err(`Unknown use of "kollaudo bug".\n\n${BUG_HELP}`);
  return 1;
}

async function link(
  key: string | undefined,
  values: ReturnType<typeof parse>["values"],
  io: Io,
): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };
  const missing: string[] = [];
  if (!key) missing.push("<key>");
  if (!values.component) missing.push("--component");
  if (!values.url) missing.push("--url");
  if (!values.test || values.test.length === 0) missing.push("--test");
  if (missing.length > 0) {
    io.err(`Missing ${missing.join(", ")}.\n\n${BUG_HELP}`);
    return 1;
  }

  const target = server(io, "an ingest token");
  if (typeof target === "string") return fail(target);

  const body = JSON.stringify({
    component: values.component as string,
    key: key as string,
    url: values.url as string,
    tests: values.test as string[],
  } satisfies BugInput);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, "/v1/bugs", {
      method: "POST",
      body,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  if (values.json) {
    io.out(`${text}\n`);
    return 0;
  }

  const saved = JSON.parse(text) as Bug;
  io.out(`Linked ${saved.key} in ${saved.component}: ${saved.state}\n`);
  for (const test of saved.tests) io.out(`  ${test}\n`);
  return 0;
}

async function close(
  key: string | undefined,
  values: ReturnType<typeof parse>["values"],
  io: Io,
): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };
  const missing: string[] = [];
  if (!key) missing.push("<key>");
  if (!values.component) missing.push("--component");
  if (!values.url) missing.push("--url");
  if (missing.length > 0) {
    io.err(`Missing ${missing.join(", ")}.\n\n${BUG_HELP}`);
    return 1;
  }

  const target = server(io, "an ingest token");
  if (typeof target === "string") return fail(target);

  const body = JSON.stringify({
    component: values.component as string,
    key: key as string,
    url: values.url as string,
    state: "closed",
  } satisfies BugInput);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, "/v1/bugs", {
      method: "POST",
      body,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  if (values.json) {
    io.out(`${text}\n`);
    return 0;
  }

  const saved = JSON.parse(text) as Bug;
  io.out(`Closed ${saved.key} in ${saved.component}\n`);
  return 0;
}

async function list(values: ReturnType<typeof parse>["values"], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  const query = new URLSearchParams();
  if (values.component) query.set("component", values.component);
  if (values.key) query.set("key", values.key);
  if (values.state) query.set("state", values.state);

  const target = server(io, "a read or ingest token");
  if (typeof target === "string") return fail(target);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, `/v1/bugs${query.size > 0 ? `?${query}` : ""}`, {
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  if (values.json) {
    io.out(`${text}\n`);
    return 0;
  }

  const { items } = JSON.parse(text) as BugList;
  if (items.length === 0) io.out("No bugs.\n");
  for (const item of items) {
    io.out(`${item.key}  ${item.state}  ${item.component}\n`);
    for (const test of item.tests) io.out(`  ${test}\n`);
  }
  return 0;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      component: { type: "string" },
      key: { type: "string" },
      url: { type: "string" },
      test: { type: "string", multiple: true },
      state: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
