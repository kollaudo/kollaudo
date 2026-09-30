import { parseArgs } from "node:util";
import type { TestRunCreated, TestRunInput } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";

export const PUSH_HELP = `Usage: kollaudo push <report> --component <name> --version <version> [options]

Send a CTRF test report to Kollaudo. Exits with 0 when Kollaudo accepts the report, even if some
tests failed: failing the pipeline on test results is the job of your test runner.

Options:
  --component <name>     Component under test, such as "frontend" (required)
  --version <version>    Version under test: a SHA, an image tag, a semver… (required)
  --env <name>           Environment the tests ran in, such as "staging". Leave it out for
                         build-level tests, such as unit tests
  --kind <kind>          unit, e2e, smoke, uat, manual… (default: e2e)
  --commit <sha>         Commit of the version
  --branch <name>        Branch of the version
  --tag <tag>            Git tag of the version
  --pull-request <id>    Pull request of the version
  --digest <digest>      Digest of the built artifact, such as a container image digest
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required)
  KOLLAUDO_TOKEN  An ingest token of your project (required)

Example:
  kollaudo push ctrf-report.json --component frontend --env staging --version 1.2.0
`;

/** How long to wait for Kollaudo. Large reports can take a while to store. */
const TIMEOUT_MS = 120_000;

export async function push(args: string[], io: Io): Promise<number> {
  const fail = (message: string) => {
    io.err(`Error: ${message}\n`);
    return 1;
  };

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${PUSH_HELP}`);
    return 1;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    io.out(PUSH_HELP);
    return 0;
  }
  if (positionals.length !== 1) {
    io.err(`Give exactly one report file.\n\n${PUSH_HELP}`);
    return 1;
  }
  const missing = (["component", "version"] as const).filter((name) => !values[name]);
  if (missing.length > 0) {
    io.err(`Missing ${missing.map((m) => `--${m}`).join(" and ")}.\n\n${PUSH_HELP}`);
    return 1;
  }

  const target = server(io, "an ingest token");
  if (typeof target === "string") return fail(target);

  const [file] = positionals as [string];
  let report: unknown;
  try {
    report = JSON.parse(await io.readFile(file));
  } catch (error) {
    const reason = error instanceof SyntaxError ? "it isn't valid JSON" : (error as Error).message;
    return fail(`Can't read ${file}: ${reason}`);
  }

  const body = {
    component: values.component as string,
    version: values.version as string,
    environment: values.env,
    kind: values.kind,
    commit: values.commit,
    branch: values.branch,
    tag: values.tag,
    pullRequest: values["pull-request"],
    digest: values.digest,
    report: report as TestRunInput["report"],
  } satisfies TestRunInput;

  let answer: Awaited<ReturnType<typeof call>>;
  try {
    answer = await call(io, target, "/v1/test-runs", {
      method: "POST",
      body: JSON.stringify(body),
      timeoutMs: TIMEOUT_MS,
    });
  } catch (error) {
    return fail((error as Error).message);
  }
  const { response, text } = answer;
  if (!response.ok) return fail(describeError(response, text, file));

  const run = JSON.parse(text) as TestRunCreated;
  io.out(`${summary(run)}\n${target.url}/test-runs/${run.id}\n`);
  return 0;
}

function summary(run: TestRunCreated) {
  const { tests, passed, failed, skipped, pending, other, flaky } = run.summary;
  const counts = Object.entries({ passed, failed, skipped, pending, other, flaky })
    .filter(([name, count]) => count > 0 || name === "passed" || name === "failed")
    .map(([name, count]) => `${count} ${name}`);
  const where = run.environment ? ` on ${run.environment}` : "";
  return (
    `Sent ${tests} ${tests === 1 ? "test" : "tests"} (${run.kind}) for ${run.component} ` +
    `${run.version}${where}: ${counts.join(", ")}`
  );
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      component: { type: "string" },
      version: { type: "string" },
      env: { type: "string" },
      kind: { type: "string" },
      commit: { type: "string" },
      branch: { type: "string" },
      tag: { type: "string" },
      "pull-request": { type: "string" },
      digest: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}
