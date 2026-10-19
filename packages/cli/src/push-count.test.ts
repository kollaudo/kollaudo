import { readFileSync } from "node:fs";
import { CtrfReport, type TestRunSummary } from "@kollaudo/schema";
import { describe, expect, it } from "vitest";
import { summarize } from "../../../apps/server/src/ingest.ts";
import { count } from "./push.ts";
import { ReportError } from "./reports.ts";

/** fixture returns the report at path relative to repo root, parsed from JSON. */
function fixture(path: string): unknown {
  const repoRoot = new URL("../../..", import.meta.url);
  return JSON.parse(readFileSync(new URL(path, repoRoot), "utf8"));
}

/** nodeAt returns the object holding the value at path, inside clone. */
function nodeAt(
  clone: Record<string | number, unknown>,
  path: (string | number)[],
): Record<string | number, unknown> {
  return path
    .slice(0, -1)
    .reduce<Record<string | number, unknown>>(
      (node, key) => node[key] as Record<string | number, unknown>,
      clone,
    );
}

/** set returns a copy of report with the value at path replaced. */
function set(report: unknown, path: (string | number)[], value: unknown): unknown {
  const clone = structuredClone(report) as Record<string | number, unknown>;
  nodeAt(clone, path)[path[path.length - 1] as string | number] = value;
  return clone;
}

/** drop returns a copy of report with the value at path removed. */
function drop(report: unknown, path: (string | number)[]): unknown {
  const clone = structuredClone(report) as Record<string | number, unknown>;
  delete nodeAt(clone, path)[path[path.length - 1] as string | number];
  return clone;
}

/** counted returns the numbers count holds, or undefined where count refuses the report. */
function counted(report: unknown): TestRunSummary | undefined {
  try {
    return count(report, undefined);
  } catch (error) {
    if (error instanceof ReportError) return undefined;
    throw error;
  }
}

const example = fixture("docs/examples/ctrf-report.json");
const valid = [
  { what: "the Playwright example", report: example },
  { what: "a passing e2e report", report: fixture("e2e/fixtures/passed.json") },
  { what: "a failing e2e report", report: fixture("e2e/fixtures/failed.json") },
];

describe("count", () => {
  it("accepts and refuses the same reports as CtrfReport", () => {
    const reports = [
      ...valid,
      {
        what: "a report without results.tool.name",
        report: drop(example, ["results", "tool", "name"]),
      },
      {
        what: "a test with an empty name",
        report: set(example, ["results", "tests", 0, "name"], ""),
      },
      {
        what: "a test with a status the format doesn't know",
        report: set(example, ["results", "tests", 0, "status"], "broken"),
      },
      {
        what: "a test with a negative duration",
        report: set(example, ["results", "tests", 0, "duration"], -1),
      },
      {
        what: "a test whose flaky isn't a boolean",
        report: set(example, ["results", "tests", 0, "flaky"], "true"),
      },
    ];

    for (const { what, report } of reports) {
      const parsed = CtrfReport.safeParse(report);
      expect(counted(report) !== undefined, what).toBe(parsed.success);
    }
  });

  it("counts the same numbers the server's summarize stores", () => {
    for (const { what, report } of valid) {
      const parsed = CtrfReport.parse(report);
      expect(count(report, undefined), what).toEqual(summarize(parsed.results.tests));
    }
  });
});
