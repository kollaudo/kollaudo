import { parseArgs } from "node:util";
import type { Override, OverrideInput, OverrideList } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const OVERRIDE_HELP = `Usage: kollaudo override --component <name> --env <name> --version <version> --reason <why> [--for 4h]
       kollaudo override list [--component <name>] [--env <name>] [--version <version>]
       kollaudo override revoke <id>

Let one version through the gate of one environment, for a while: the verdict passes, and says it
was overridden, by whom and why. For urgent fixes, when the evidence can't be had in time. Every
override is kept, so you can see who let what through, and how often.

Options:
  --component <name>     Component, such as "api" (required)
  --env <name>           Environment of the gate, such as "staging" (required)
  --version <version>    Version to let through (required)
  --reason <why>         Why, in a few words: what people will read later (required)
  --for <duration>       How long it holds, such as 30m or 4h, at most 24h (default: 4h)
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  A token of the override scope, held by people, not pipelines (required)

Example:
  kollaudo override --component api --env staging --version 3f2a9c1 \\
    --reason "Hotfix for incident 1234, e2e environment down" --for 2h
`;

const TIMEOUT_MS = 30_000;

export async function override(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${OVERRIDE_HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    io.out(OVERRIDE_HELP);
    return 0;
  }

  const [action, id, ...rest] = positionals;
  let path: string;
  let method = "GET";
  let body: string | undefined;
  if (action === "list" && !id) {
    const query = new URLSearchParams();
    if (values.component) query.set("component", values.component);
    if (values.env) query.set("environment", values.env);
    if (values.version) query.set("version", values.version);
    path = `/v1/overrides${query.size > 0 ? `?${query}` : ""}`;
  } else if (action === "revoke" && id && rest.length === 0) {
    path = `/v1/overrides/${encodeURIComponent(id)}/revoke`;
    method = "POST";
  } else if (!action) {
    const missing = (["component", "env", "version", "reason"] as const).filter((n) => !values[n]);
    if (missing.length > 0) {
      io.err(`Missing ${missing.map((m) => `--${m}`).join(", ")}.\n\n${OVERRIDE_HELP}`);
      return 1;
    }
    path = "/v1/overrides";
    method = "POST";
    body = JSON.stringify({
      component: values.component as string,
      environment: values.env as string,
      version: values.version as string,
      reason: values.reason as string,
      for: values.for,
    } satisfies OverrideInput);
  } else {
    io.err(`Unknown use of "kollaudo override".\n\n${OVERRIDE_HELP}`);
    return 1;
  }

  const target = server(io, "a token of the override scope");
  if (typeof target === "string") return fail(target);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, path, { method, body, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  if (action === "list") {
    const { items } = JSON.parse(text) as OverrideList;
    if (items.length === 0) io.out("No overrides.\n");
    for (const o of items) io.out(`${line(o)}\n`);
  } else {
    io.out(`${line(JSON.parse(text) as Override)}\n`);
  }
  return 0;
}

/** One override on one line, with its id to revoke it. */
function line(o: Override) {
  const state = o.revokedAt
    ? `revoked ${o.revokedAt}`
    : o.active
      ? `until ${o.expiresAt}`
      : `expired ${o.expiresAt}`;
  return `${o.id}  ${o.component} ${o.version} in ${o.environment}, ${state}, by ${o.by ?? "a deleted token"}: ${o.reason}`;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      component: { type: "string" },
      env: { type: "string" },
      version: { type: "string" },
      reason: { type: "string" },
      for: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
