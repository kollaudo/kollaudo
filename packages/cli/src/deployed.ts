import { parseArgs } from "node:util";
import type { Deployment, DeploymentInput } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const DEPLOYED_HELP = `Usage: kollaudo deployed --component <name> --env <name> --version <version> [options]

Tell Kollaudo that a version now runs in an environment. Kollaudo never deploys anything: run this
after your deployment tool did, so Kollaudo can show what runs where, next to what was tested.

Options:
  --component <name>     Component that was deployed, such as "api" (required)
  --env <name>           Environment it runs in, such as "staging" (required)
  --version <version>    Version that was deployed, as sent with "kollaudo push" (required)
  --at <time>            When it started running, such as 2026-10-01T09:00:00Z (default: now)
  --tool <name>          Tool that deployed it, such as "argocd" or "helm"
  --commit <sha>         Commit of the version
  --branch <name>        Branch of the version
  --tag <tag>            Git tag of the version
  --pull-request <id>    Pull request of the version
  --digest <digest>      Digest of the deployed artifact, such as a container image digest
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  An ingest token of your project (required)

Example:
  kollaudo deployed --component api --env staging --version 3f2a9c1 --tool helm
`;

const TIMEOUT_MS = 30_000;

export async function deployed(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${DEPLOYED_HELP}`);
    return 1;
  }
  const { values } = parsed;

  if (values.help) {
    io.out(DEPLOYED_HELP);
    return 0;
  }
  const missing = (["component", "env", "version"] as const).filter((name) => !values[name]);
  if (missing.length > 0) {
    io.err(`Missing ${list(missing.map((m) => `--${m}`))}.\n\n${DEPLOYED_HELP}`);
    return 1;
  }

  let deployedAt: string | undefined;
  if (values.at) {
    const time = Date.parse(values.at);
    if (Number.isNaN(time)) return fail(`--at isn't a date and time: ${values.at}`);
    deployedAt = new Date(time).toISOString();
  }

  const target = server(io, "an ingest token");
  if (typeof target === "string") return fail(target);

  const body = {
    component: values.component as string,
    environment: values.env as string,
    version: values.version as string,
    deployedAt,
    tool: values.tool,
    commit: values.commit,
    branch: values.branch,
    tag: values.tag,
    pullRequest: values["pull-request"],
    digest: values.digest,
  } satisfies DeploymentInput;

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, "/v1/deployments", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text));

  const deployment = JSON.parse(text) as Deployment;
  const by = deployment.tool ? ` (${deployment.tool})` : "";
  io.out(
    `Recorded ${deployment.component} ${deployment.version} running in ` +
      `${deployment.environment} since ${deployment.deployedAt}${by}\n`,
  );
  // Recorded all the same: Kollaudo shows what happened, and says it went around the gate (ADR 0019).
  if (deployment.gate && !deployment.gate.gated) {
    io.out(
      `Ungated: Kollaudo gave no pass for ${deployment.version} in ${deployment.gate.from} ` +
        "before it was deployed.\n",
    );
  }
  return 0;
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
      at: { type: "string" },
      tool: { type: "string" },
      commit: { type: "string" },
      branch: { type: "string" },
      tag: { type: "string" },
      "pull-request": { type: "string" },
      digest: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
