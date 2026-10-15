import { parseArgs } from "node:util";
import type { CtrfReport, TestRunCreated, TestRunInput, TestRunSummary } from "@kollaudo/schema";
import { call, describeError, server } from "./api.ts";
import type { Io } from "./io.ts";
import { JunitError } from "./junit.ts";
import { type Loaded, loadReport, ReportError } from "./reports.ts";

export const PUSH_HELP = `Usage: kollaudo push <report>... --component <name> --version <version> [options]

Send test results to Kollaudo, as CTRF reports (JSON) or JUnit reports (XML). Several files, or
glob patterns in quotes, make one test run. Exits with 0 when Kollaudo accepts the results, even if
some tests failed: failing the pipeline on test results is the job of your test runner.

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
  --tool <name>          Tool that ran the tests, such as "pytest". JUnit reports don't say it
                         (default: junit)
  --dry-run              Read the reports and print what would be sent, without sending it.
                         KOLLAUDO_URL and KOLLAUDO_TOKEN aren't needed
  -h, --help             Show this help

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server (required, except with --dry-run)
  KOLLAUDO_TOKEN  An ingest token of your project (required, except with --dry-run)

Examples:
  kollaudo push ctrf-report.json --component frontend --env staging --version 1.2.0
  kollaudo push "test-results/**/*.xml" --component api --version 3f2a9c1 --kind unit --tool maven
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
  if (positionals.length === 0) {
    io.err(`Give at least one report file.\n\n${PUSH_HELP}`);
    return 1;
  }
  const missing = (["component", "version"] as const).filter((name) => !values[name]);
  if (missing.length > 0) {
    io.err(`Missing ${missing.map((m) => `--${m}`).join(" and ")}.\n\n${PUSH_HELP}`);
    return 1;
  }

  // A dry run reads the reports but never calls the server, so it needs no URL or token.
  const target = values["dry-run"] ? undefined : server(io, "an ingest token");
  if (typeof target === "string") return fail(target);

  let loaded: Loaded;
  try {
    loaded = await loadReport(positionals, io, values.tool);
  } catch (error) {
    if (error instanceof ReportError || error instanceof JunitError) return fail(error.message);
    throw error;
  }
  // Errors in the report point to the file, when there is one file as it was sent.
  const file = loaded.format === "CTRF" && loaded.files.length === 1 ? loaded.files[0] : undefined;

  if (target === undefined) {
    let counts: TestRunSummary;
    try {
      counts = count(loaded.report, file);
    } catch (error) {
      if (error instanceof ReportError) return fail(error.message);
      throw error;
    }
    const run = {
      component: values.component as string,
      version: values.version as string,
      environment: values.env ?? null,
      kind: values.kind ?? "e2e",
      summary: counts,
    };
    io.out(`${summary(run, loaded, "Would send")}\nNothing was sent (--dry-run).\n`);
    return 0;
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
    report: loaded.report as TestRunInput["report"],
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
  io.out(`${summary(run, loaded)}\n${target.url}/test-runs/${run.id}\n`);
  return 0;
}

const STATUSES = ["passed", "failed", "skipped", "pending", "other"] as const;

/**
 * Counts the tests of a report for a dry run, as `summarize` in apps/server/src/ingest.ts does when
 * it stores a run: keep the two in step. The published CLI has neither @kollaudo/schema nor zod, so
 * the fields `CtrfTest` requires (packages/schema/src/ctrf.ts) are checked here by hand.
 */
function count(report: unknown, file: string | undefined): TestRunSummary {
  const where = file ? `${file}: ` : "";
  // mergeCtrf checks this for several CTRF files, but one file comes as it was written.
  const results = (report as CtrfReport | undefined)?.results;
  const tests = results?.tests;
  if (!Array.isArray(tests)) {
    throw new ReportError(`${file ?? "The report"} isn't a CTRF report: it has no results.tests.`);
  }
  const toolName = results?.tool?.name;
  if (typeof toolName !== "string" || toolName === "") {
    throw invalid(`${where}results.tool.name`, toolName, "a non-empty string");
  }
  const totalTests = results?.summary?.tests;
  if (typeof totalTests !== "number" || !Number.isInteger(totalTests) || totalTests < 0) {
    throw invalid(`${where}results.summary.tests`, totalTests, "a whole number of 0 or more");
  }
  const counts = {
    tests: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    other: 0,
    flaky: 0,
  };
  tests.forEach((test, index) => {
    const at = `${where}results.tests.${index}`;
    if (typeof test?.name !== "string" || test.name === "") {
      throw invalid(`${at}.name`, test?.name, "a non-empty string");
    }
    const status = test.status;
    // Only the five statuses are counted, so a status such as "__proto__" never indexes `counts`.
    if (!STATUSES.includes(status)) {
      throw invalid(`${at}.status`, status, "passed, failed, skipped, pending or other");
    }
    if (typeof test.duration !== "number" || test.duration < 0) {
      throw invalid(`${at}.duration`, test.duration, "a number of 0 or more");
    }
    if (test.flaky !== undefined && typeof test.flaky !== "boolean") {
      throw invalid(`${at}.flaky`, test.flaky, "true or false");
    }
    counts[status]++;
    if (test.flaky) counts.flaky++;
  });
  return counts;
}

function invalid(path: string, value: unknown, expected: string) {
  const found = value === undefined ? "missing" : JSON.stringify(value);
  return new ReportError(`${path} is ${found}, not ${expected}.`);
}

function summary(run: Omit<TestRunCreated, "id">, { format, files }: Loaded, verb = "Sent") {
  const { tests, passed, failed, skipped, pending, other, flaky } = run.summary;
  const counts = Object.entries({ passed, failed, skipped, pending, other, flaky })
    .filter(([name, count]) => count > 0 || name === "passed" || name === "failed")
    .map(([name, count]) => `${count} ${name}`);
  const where = run.environment ? ` on ${run.environment}` : "";
  const from =
    format === "JUnit" || files.length > 1
      ? ` from ${files.length} ${format} ${files.length === 1 ? "file" : "files"}`
      : "";
  return (
    `${verb} ${tests} ${tests === 1 ? "test" : "tests"} (${run.kind})${from} for ${run.component} ` +
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
      tool: { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
