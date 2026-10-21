import { parseArgs } from "node:util";
import type { DeploymentList } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const DEPLOYED_LIST_HELP = `Usage: kollaudo deployed list [options]

List deployments, newest first, with when each version started running and the tool that deployed
it. Exits with 0, or 1 if the list can't be retrieved.

Options:
  --component <name>     Only this component
  --env <name>           Only this environment
  --version <version>    Only this version
  --json                 Print the API's answer as JSON, including the next cursor
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  A read token of your project (required)

Example:
  kollaudo deployed list --component api --env staging
`;

const TIMEOUT_MS = 30_000;

export async function deployedList(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${DEPLOYED_LIST_HELP}`);
    return 1;
  }
  const { values } = parsed;
  if (values.help) {
    io.out(DEPLOYED_LIST_HELP);
    return 0;
  }

  const query = new URLSearchParams();
  if (values.component) query.set("component", values.component);
  if (values.env) query.set("environment", values.env);
  if (values.version) query.set("version", values.version);

  const target = server(io, "a read token");
  if (typeof target === "string") return fail(target);

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, `/v1/deployments${query.size > 0 ? `?${query}` : ""}`, {
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

  const { items } = JSON.parse(text) as DeploymentList;
  if (items.length === 0) io.out("No deployments.\n");
  for (const deployment of items) {
    const by = deployment.tool ? ` (${deployment.tool})` : "";
    io.out(
      `${deployment.deployedAt}  ${deployment.component} ${deployment.version} in ${deployment.environment}${by}\n`,
    );
  }
  return 0;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    options: {
      component: { type: "string" },
      env: { type: "string" },
      version: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
