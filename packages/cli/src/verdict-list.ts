import { parseArgs } from "node:util";
import type { GivenVerdict, GivenVerdictList } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const VERDICT_LIST_HELP = `Usage: kollaudo verdict list [options]

List the verdicts Kollaudo gave, newest first: who asked about which version, and what they were
told, with the policy revision and the override that let a version through. Exits with 0, or 1 if
the list can't be had.

Options:
  --component <name>     Only this component
  --env <name>           Only this environment
  --version <version>    Only this version
  --outcome <outcome>    Only pass, fail or unknown
  --limit <n>            How many, at most 200 (default: 50)
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  A read token of your project (required)

Example:
  kollaudo verdict list --component api --env staging --outcome fail
`;

const TIMEOUT_MS = 30_000;

export async function verdictList(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${VERDICT_LIST_HELP}`);
    return 1;
  }
  const { values } = parsed;
  if (values.help) {
    io.out(VERDICT_LIST_HELP);
    return 0;
  }

  const query = new URLSearchParams();
  if (values.component) query.set("component", values.component);
  if (values.env) query.set("environment", values.env);
  if (values.version) query.set("version", values.version);
  if (values.outcome) query.set("outcome", values.outcome);
  if (values.limit) query.set("limit", values.limit);

  const target = server(io, "a read token");
  if (typeof target === "string") return fail(target);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, `/v1/verdicts${query.size > 0 ? `?${query}` : ""}`, {
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  const { items } = JSON.parse(text) as GivenVerdictList;
  if (items.length === 0) io.out("No verdicts.\n");
  for (const v of items) io.out(`${line(v)}\n`);
  return 0;
}

/**
 * 2026-10-02T09:10:00.000Z  FAIL  api 1.1.0 in staging, asked by kargo, policy revision 3: e2e failed.
 */
function line(v: GivenVerdict) {
  const outcome = v.overrideId ? `${v.outcome.toUpperCase()} (override)` : v.outcome.toUpperCase();
  const policy = v.policyRevision === null ? "" : `, policy revision ${v.policyRevision}`;
  return (
    `${v.createdAt}  ${outcome}  ${v.component} ${v.version} in ${v.environment}, ` +
    `asked by ${v.askedBy ?? "a deleted token"}${policy}: ${v.message}`
  );
}

function parse(args: string[]) {
  return parseArgs({
    args,
    options: {
      component: { type: "string" },
      env: { type: "string" },
      version: { type: "string" },
      outcome: { type: "string" },
      limit: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
