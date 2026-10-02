import { parseArgs } from "node:util";
import type { Policy, PolicyInput } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const POLICY_HELP = `Usage: kollaudo policy <push|check> <file>
       kollaudo policy show

The rules your verdicts apply, kept by Kollaudo: which kinds of test each environment requires,
whether tests count only for the deployed version, flaky tests, how old a run can be. Keep the file
in a repository, and send it from there: each push is a new revision.

Commands:
  push <file>   Make the file the project's policy. Needs a token of the policy scope
  check <file>  Check the file, and keep nothing. Any token of the project works
  show          Print the project's policy

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  A token of your project: a policy token to push (required)

Example of a policy file:
  environments:
    staging:
      require: [e2e, smoke]
      deployed: true
    "pr-*":
      require: [e2e]

See https://github.com/kollaudo/kollaudo/blob/main/docs/policies.md
`;

const TIMEOUT_MS = 30_000;

export async function policy(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${POLICY_HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const [action, file, ...rest] = positionals;

  if (values.help || !action) {
    io.out(POLICY_HELP);
    return values.help ? 0 : 1;
  }
  const withFile = action === "push" || action === "check";
  if (!(withFile || action === "show") || (withFile && !file) || rest.length > 0) {
    io.err(`Use "kollaudo policy push <file>", "check <file>" or "show".\n\n${POLICY_HELP}`);
    return 1;
  }

  const target = server(io, action === "push" ? "a policy token" : "a token");
  if (typeof target === "string") return fail(target);

  let body: string | undefined;
  if (withFile) {
    let source: string;
    try {
      source = await io.readFile(file as string);
    } catch (error) {
      return fail(`Can't read ${file}: ${(error as Error).message}`);
    }
    body = JSON.stringify({ source } satisfies PolicyInput);
  }

  const path = { push: "/v1/policy", check: "/v1/policy/check", show: "/v1/policy" }[action];
  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, path as string, {
      method: body === undefined ? "GET" : "POST",
      body,
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) {
    const described = describeError(response, text);
    // Each problem is in the file: its path is a chain of YAML keys, empty for a syntax error.
    return fail(file ? described.replace(/\n {2}(?:: )?/g, `\n  ${file}: `) : described);
  }

  if (action === "check") {
    io.out(`${file} is a valid policy.\n`);
  } else if (action === "push") {
    const pushed = JSON.parse(text) as Policy;
    io.out(`Policy revision ${pushed.revision} applies from now on, sent by ${pushed.sentBy}.\n`);
  } else {
    const current = JSON.parse(text) as Policy;
    io.out(
      `# Revision ${current.revision}, sent by ${current.sentBy ?? "a deleted token"} on ${current.createdAt}\n` +
        `${current.source.trimEnd()}\n`,
    );
  }
  return 0;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: { help: { type: "boolean", short: "h" } },
  });
}
