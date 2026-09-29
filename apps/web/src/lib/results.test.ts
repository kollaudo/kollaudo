import type { TestResult } from "@kollaudo/schema";
import { describe, expect, it } from "vitest";
import { groupBySuite, outcome, sortEnvironments } from "./results.ts";

const summary = { tests: 0, passed: 0, failed: 0, skipped: 0, pending: 0, other: 0, flaky: 0 };

describe("outcome", () => {
  it("is failed as soon as one test failed", () => {
    expect(outcome({ ...summary, tests: 3, passed: 2, failed: 1 })).toBe("failed");
    expect(outcome({ ...summary, tests: 2, passed: 1, skipped: 1 })).toBe("passed");
    expect(outcome({ ...summary, tests: 1, skipped: 1 })).toBe("empty");
  });
});

function result(name: string, status: TestResult["status"], suite: string[]): TestResult {
  return {
    id: name,
    name,
    suite,
    status,
    file: null,
    durationMs: 1,
    message: null,
    trace: null,
    retries: 0,
    flaky: false,
    tags: [],
    extra: null,
  };
}

describe("groupBySuite", () => {
  it("puts suites and tests with failures first", () => {
    const groups = groupBySuite([
      result("logs in", "passed", ["auth"]),
      result("pays", "passed", ["checkout"]),
      result("refunds", "failed", ["checkout"]),
      result("logs out", "skipped", ["auth"]),
    ]);

    expect(groups.map((g) => [g.suite.join(), g.results.map((r) => r.name)])).toEqual([
      ["checkout", ["refunds", "pays"]],
      ["auth", ["logs out", "logs in"]],
    ]);
  });
});

describe("sortEnvironments", () => {
  it("goes from development to production", () => {
    expect(
      sortEnvironments([
        "production",
        "staging",
        "dev",
        "qa",
        "preview-pr-12",
        "sandbox",
        "preprod",
      ]),
    ).toEqual(["dev", "preview-pr-12", "qa", "preprod", "staging", "sandbox", "production"]);
  });
});
