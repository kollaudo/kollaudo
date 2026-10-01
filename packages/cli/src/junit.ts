// JUnit XML to CTRF, following the mapping of ADR 0015. JUnit has no specification: each tool writes
// its own dialect, so every rule here comes from a real file kept in the tests.

import type { CtrfReport, CtrfTest } from "@kollaudo/schema";
import { XMLParser } from "fast-xml-parser";

export interface JunitFile {
  /** The path, for error messages. */
  name: string;
  xml: string;
}

/** Elements that can repeat, so they are always arrays. */
const LISTS = new Set([
  "testsuite",
  "testcase",
  "failure",
  "error",
  "skipped",
  "flakyFailure",
  "flakyError",
  "rerunFailure",
  "rerunError",
  "property",
  "system-out",
  "system-err",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "#text",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  // Numeric character references, such as &#10; in pytest's messages.
  htmlEntities: true,
  isArray: (name) => LISTS.has(name),
});

// fast-xml-parser returns untyped objects: these describe the parts the mapping reads.
type Node = Record<string, unknown>;
type Text = string | Node;

/** One test case of one attempt, before attempts of the same test are merged. */
interface Attempt {
  key: string;
  test: CtrfTest;
}

export class JunitError extends Error {}

/** Converts JUnit XML files to one CTRF report. */
export function junitToCtrf(files: JunitFile[], tool: string): CtrfReport {
  const attempts: Attempt[] = [];
  const times: { start: number; stop: number }[] = [];

  for (const file of files) {
    let root: Node;
    try {
      root = parser.parse(file.xml, true) as Node;
    } catch (error) {
      throw new JunitError(`${file.name} isn't valid XML: ${(error as Error).message}`);
    }
    const top = (root.testsuites as Node | undefined) ?? root;
    const suites = list(top.testsuite);
    if (!root.testsuites && suites.length === 0) {
      throw new JunitError(
        `${file.name} isn't a JUnit report: it has no <testsuites> or <testsuite>.`,
      );
    }
    for (const suite of suites) walk(suite, [], attempts, times);
    // Some tools put test cases straight under <testsuites>.
    for (const testcase of list(top.testcase)) attempts.push(attempt(testcase, []));
  }

  const tests = merge(attempts);
  const start = times.length > 0 ? Math.min(...times.map((t) => t.start)) : undefined;
  const stop = times.length > 0 ? Math.max(...times.map((t) => t.stop)) : undefined;
  return {
    reportFormat: "CTRF",
    specVersion: "0.0.0",
    results: {
      tool: { name: tool },
      summary: { tests: tests.length, ...(start !== undefined && { start, stop }) },
      tests,
    },
  };
}

function walk(
  suite: Node,
  parents: string[],
  attempts: Attempt[],
  times: { start: number; stop: number }[],
) {
  const name = attribute(suite, "name");
  const path = name ? [...parents, name] : parents;

  // Only timestamps with a time zone: without one, the time of day depends on the machine.
  const timestamp = attribute(suite, "timestamp");
  if (timestamp && /(Z|[+-]\d\d:?\d\d)$/.test(timestamp)) {
    const start = Date.parse(timestamp);
    if (!Number.isNaN(start)) times.push({ start, stop: start + seconds(suite) });
  }

  for (const testcase of list(suite.testcase)) attempts.push(attempt(testcase, path));
  for (const child of list(suite.testsuite)) walk(child, path, attempts, times);
}

function attempt(testcase: Node, suites: string[]): Attempt {
  const name = attribute(testcase, "name") ?? "(unnamed test)";
  const classname = attribute(testcase, "classname");
  const suite = classname && classname !== suites.at(-1) ? [...suites, classname] : suites;

  const failure = list(testcase.failure)[0] ?? list(testcase.error)[0];
  const skipped = list(testcase.skipped)[0];
  const flakes = list(testcase.flakyFailure).length + list(testcase.flakyError).length;
  const reruns = list(testcase.rerunFailure).length + list(testcase.rerunError).length;

  const test: CtrfTest = {
    name,
    status: failure ? "failed" : skipped !== undefined ? "skipped" : "passed",
    duration: seconds(testcase),
  };
  if (suite.length > 0) test.suite = suite;
  const file = attribute(testcase, "file");
  if (file) test.filePath = file;

  if (failure) {
    const trace = text(failure);
    const message = meaningful(failure) ?? trace?.split("\n")[0] ?? attribute(failure, "type");
    if (message) test.message = message;
    if (trace) test.trace = trace;
  } else if (skipped !== undefined) {
    const message = meaningful(skipped) ?? text(skipped);
    if (message) test.message = message;
  }

  if (failure && reruns > 0) test.retries = reruns;
  if (!failure && flakes > 0) {
    test.retries = flakes;
    test.flaky = true;
  }

  const stdout = list(testcase["system-out"])
    .map(text)
    .filter((t): t is string => !!t);
  const stderr = list(testcase["system-err"])
    .map(text)
    .filter((t): t is string => !!t);
  if (stdout.length > 0) test.stdout = stdout;
  if (stderr.length > 0) test.stderr = stderr;

  const properties = Object.fromEntries(
    list((testcase.properties as Node | undefined)?.property).flatMap((property) => {
      const key = attribute(property, "name");
      return key ? [[key, attribute(property, "value") ?? text(property) ?? ""]] : [];
    }),
  );
  if (Object.keys(properties).length > 0) test.extra = { junit: { properties } };

  return { key: `${suite.join("\u0000")}\u0000${name}`, test };
}

/**
 * Several test cases for the same test are attempts of it (Gradle, Playwright…): the last one
 * gives the status, the others are retries, and a pass after a failure is flaky.
 */
function merge(attempts: Attempt[]): CtrfTest[] {
  const byKey = new Map<string, CtrfTest[]>();
  for (const { key, test } of attempts) byKey.set(key, [...(byKey.get(key) ?? []), test]);

  return [...byKey.values()].map((tries) => {
    const last = tries.at(-1) as CtrfTest;
    if (tries.length === 1) return last;
    const failedBefore = tries.slice(0, -1).some((t) => t.status === "failed");
    return {
      ...last,
      duration: tries.reduce((total, t) => total + t.duration, 0),
      retries: tries.length - 1 + (last.retries ?? 0),
      ...(last.status === "passed" && failedBefore && { flaky: true }),
    };
  });
}

function list(value: unknown): Node[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map((v) =>
    typeof v === "object" ? v : { "#text": v },
  );
}

/** go-junit-report writes message="Failed" and message="Skipped": the reason is in the text. */
const GENERIC = new Set(["failed", "failure", "error", "skipped"]);

function meaningful(node: Node): string | undefined {
  const message = attribute(node, "message");
  return message && !GENERIC.has(message.trim().toLowerCase()) ? message : undefined;
}

function attribute(node: Node, name: string): string | undefined {
  const value = node[name];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** The text of an element, with CDATA, trimmed. Empty text is undefined. */
function text(node: Text): string | undefined {
  const value = typeof node === "string" ? node : node["#text"];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** `time` in seconds, as milliseconds. Some tools write "1,234.5": the commas are thousands. */
function seconds(node: Node): number {
  const time = Number((attribute(node, "time") ?? "0").replaceAll(",", ""));
  return Number.isFinite(time) && time > 0 ? Math.round(time * 1000) : 0;
}
