import { parseArgs } from "node:util";
import type { Signoff, SignoffInput, SignoffList, Verdict } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";
import { report } from "./verdict.ts";

export const SIGNOFF_HELP = `Usage: kollaudo signoff --component <name> --env <name> --version <version> --kind <kind> --outcome <pass|fail> [--note <text>]
       kollaudo signoff list [--component <name>] [--env <name>] [--version <version>] [--kind <kind>] [--json]

Sign off a version you checked yourself, such as a UAT or a manual check, and print the verdict that
follows. A policy can require a sign-off for a kind ("signoff: [uat]"): a report of that kind sent by
a pipeline doesn't count, only this does. Sign off again to change your mind: the latest one counts,
and the earlier ones are kept.

The command exits with 0 once the sign-off is recorded, whatever the verdict. To gate on the verdict,
use "kollaudo verdict". "kollaudo signoff list" shows the sign-offs, newest first, and its options
filter them.

Options:
  --component <name>     Component, such as "checkout" (required)
  --env <name>           Environment where you checked it, such as "staging" (required)
  --version <version>    Version you checked (required)
  --kind <kind>          What you checked, such as uat or manual (required)
  --outcome <outcome>    pass or fail (required)
  --note <text>          What you checked, or what is wrong: what people will read later
  --json                 Print the sign-off and the verdict as JSON instead of the report, or the
                         list API's answer instead of the one-line format
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  A token of the signoff scope, held by people, not pipelines (required).
                  A token of the read scope can list the sign-offs too

Example:
  kollaudo signoff --component checkout --env staging --version 3f2a9c1 \\
    --kind uat --outcome pass --note "Checked the new payment page with the two test cards"
`;

const TIMEOUT_MS = 30_000;

export async function signoff(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${SIGNOFF_HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(SIGNOFF_HELP);
    return 0;
  }
  if (positionals[0] === "list" && positionals.length === 1) return list(values, io);
  if (positionals.length > 0) {
    io.err(`Unknown use of "kollaudo signoff".\n\n${SIGNOFF_HELP}`);
    return 1;
  }
  const missing = (["component", "env", "version", "kind", "outcome"] as const).filter(
    (name) => !values[name],
  );
  if (missing.length > 0) {
    io.err(`Missing ${missing.map((m) => `--${m}`).join(", ")}.\n\n${SIGNOFF_HELP}`);
    return 1;
  }
  const outcome = values.outcome;
  if (outcome !== "pass" && outcome !== "fail") {
    return fail("--outcome must be pass or fail.");
  }

  const target = server(io, "a token of the signoff scope");
  if (typeof target === "string") return fail(target);

  const body = JSON.stringify({
    component: values.component as string,
    environment: values.env as string,
    version: values.version as string,
    kind: values.kind as string,
    outcome,
    note: values.note,
  } satisfies SignoffInput);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, "/v1/signoffs", {
      method: "POST",
      body,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  if (!answer.response.ok) return fail(describeError(answer.response, answer.text));
  const given = JSON.parse(answer.text) as Signoff;

  // The verdict that follows. It isn't recorded in the log: a sign-off isn't a gate (ADR 0019).
  const query = new URLSearchParams({
    component: given.component,
    environment: given.environment,
    version: given.version,
    record: "false",
  });
  const unread = "The sign-off is recorded, but the verdict can't be read.";
  let followed: Awaited<ReturnType<typeof call>>;
  try {
    followed = await call(io, target, `/v1/verdict?${query}`, { timeoutMs: TIMEOUT_MS });
  } catch (error) {
    return fail(`${unread} ${(error as Error).message}`);
  }
  if (!followed.response.ok) {
    return fail(`${unread} ${describeError(followed.response, followed.text)}`);
  }

  if (values.json) {
    io.out(`${JSON.stringify({ signoff: given, verdict: JSON.parse(followed.text) })}\n`);
  } else {
    const note = given.note ? `: ${given.note}` : "";
    io.out(
      `Signed off ${given.component} ${given.version} in ${given.environment}: ${given.kind} ${given.outcome}, by ${given.by ?? "a deleted token"}${note}\n\n`,
    );
    io.out(report(JSON.parse(followed.text) as Verdict, target.url));
  }
  return 0;
}

async function list(values: ReturnType<typeof parse>["values"], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };
  const target = server(io, "a token of the read or signoff scope");
  if (typeof target === "string") return fail(target);

  const query = new URLSearchParams();
  if (values.component) query.set("component", values.component);
  if (values.env) query.set("environment", values.env);
  if (values.version) query.set("version", values.version);
  if (values.kind) query.set("kind", values.kind);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, `/v1/signoffs${query.size > 0 ? `?${query}` : ""}`, {
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
  const { items } = JSON.parse(text) as SignoffList;
  if (items.length === 0) io.out("No sign-offs.\n");
  for (const s of items) io.out(`${line(s)}\n`);
  return 0;
}

/** One sign-off on one line: when, the outcome, what was checked, who gave it and the note. */
function line(s: Signoff) {
  const note = s.note ? `: ${s.note}` : "";
  return `${s.createdAt}  ${s.outcome}  ${s.component} ${s.version} in ${s.environment}, ${s.kind}, by ${s.by ?? "a deleted token"}${note}`;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      component: { type: "string" },
      env: { type: "string" },
      version: { type: "string" },
      kind: { type: "string" },
      outcome: { type: "string" },
      note: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
