import { parseArgs } from "node:util";
import type { Verdict } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";
import { verdictList } from "./verdict-list.ts";

export const VERDICT_HELP = `Usage: kollaudo verdict --component <name> --env <name> --version <version> [options]
       kollaudo verdict list [options]

Ask Kollaudo whether a version is healthy in an environment, and exit with the answer. Use it as a
gate: to promote a version to production, ask for its verdict in staging.

Exit codes:
  0  pass     every kind of test that ran passed
  1  fail     the latest run of a kind has failed tests
  2  unknown  evidence is missing: no runs, or no run of a required kind
  3  no verdict: Kollaudo can't be reached, or the token or the options are wrong

A pipeline that lets "unknown" through, or goes ahead when Kollaudo is down, has to check for 2
or 3 explicitly.

Kollaudo records every verdict it gives, with the token that asked: "kollaudo verdict list" shows
them (see "kollaudo verdict list --help").

Options:
  --component <name>     Component, such as "frontend" (required)
  --env <name>           Environment the version was tested in, such as "staging" (required)
  --version <version>    Version, as sent with "kollaudo push" (required)
  --require <kinds>      Kinds that must have a run, separated by commas, such as e2e,smoke
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  A read or ingest token of your project (required)

Example:
  kollaudo verdict --component frontend --env staging --version 1.2.0 --require e2e,smoke
`;

const EXIT_CODES = { pass: 0, fail: 1, unknown: 2 } as const;
const NO_VERDICT = 3;

const TIMEOUT_MS = 30_000;

export async function verdict(args: string[], io: Io): Promise<number> {
  if (args[0] === "list") return verdictList(args.slice(1), io);
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return NO_VERDICT;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${VERDICT_HELP}`);
    return NO_VERDICT;
  }
  const { values } = parsed;

  if (values.help) {
    io.out(VERDICT_HELP);
    return 0;
  }
  const missing = (["component", "env", "version"] as const).filter((name) => !values[name]);
  if (missing.length > 0) {
    io.err(`Missing ${list(missing.map((m) => `--${m}`))}.\n\n${VERDICT_HELP}`);
    return NO_VERDICT;
  }

  const target = server(io, "a read or ingest token");
  if (typeof target === "string") return fail(target);

  const query = new URLSearchParams({
    component: values.component as string,
    environment: values.env as string,
    version: values.version as string,
  });
  if (values.require) query.set("require", values.require);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, `/v1/verdict?${query}`, { timeoutMs: TIMEOUT_MS });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  const result = JSON.parse(text) as Verdict;
  io.out(report(result, target.url));
  return EXIT_CODES[result.outcome];
}

/**
 * FAIL  api 1.1.0 in staging: smoke failed.
 *
 *   pass  e2e    1 passed  https://kollaudo.example.com/test-runs/…
 *   fail  smoke  1 failed, 1 passed  https://kollaudo.example.com/test-runs/…
 */
function report(result: Verdict, url: string) {
  const { component, version, environment, outcome, message, reasons } = result;
  // An override lets the version through: the gate's log must show it (ADR 0018).
  const label = result.override ? `${outcome.toUpperCase()} (override)` : outcome.toUpperCase();
  const lines = [`${label}  ${component} ${version} in ${environment}: ${message}`];
  if (result.override) {
    lines.push(`The evidence alone is ${result.evidenceOutcome}.`);
  }
  const { policy } = result;
  if (policy.name === "project") lines.push(`Policy revision ${policy.revision}.`);

  const width = Math.max(...reasons.map((r) => r.kind.length));
  if (reasons.length > 0) lines.push("");
  for (const reason of reasons) {
    const link = reason.run ? `  ${url}/test-runs/${reason.run.id}` : "";
    // Who sent the evidence (ADR 0017): when a verdict surprises, that's the first question.
    const by = reason.run?.sentBy ? `  by ${reason.run.sentBy}` : "";
    lines.push(
      `  ${reason.outcome.padEnd(7)}  ${reason.kind.padEnd(width)}  ${reason.message}${by}${link}`,
    );
  }
  // The outcome doesn't change, but a gate should know if it judged a version that isn't running.
  const { deployed } = result;
  if (deployed && deployed.version !== version) {
    lines.push(
      "",
      `Note: ${environment} runs ${component} ${deployed.version} since ${deployed.deployedAt}, ` +
        `not ${version}.`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/** "--a", "--a and --b", "--a, --b and --c". */
function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    options: {
      component: { type: "string" },
      env: { type: "string" },
      version: { type: "string" },
      require: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
