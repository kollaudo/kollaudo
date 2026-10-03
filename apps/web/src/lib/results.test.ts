import type { Deployment, TestResult, TestRun } from "@kollaudo/schema";
import { describe, expect, it } from "vitest";
import { groupBySuite, outcome, sortEnvironments, versionToJudge } from "./results.ts";

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

describe("versionToJudge", () => {
  const run = (version: string, createdAt: string) =>
    ({ version, createdAt }) as unknown as TestRun;
  const runs = [
    run("1.1.0", "2026-10-02T10:00:00.000Z"),
    run("1.2.0", "2026-10-03T10:00:00.000Z"),
    run("1.0.0", "2026-10-01T10:00:00.000Z"),
  ];

  it("is the deployed version, which is the one gates ask about", () => {
    expect(versionToJudge(runs, { version: "1.0.0" } as Deployment)).toBe("1.0.0");
    expect(versionToJudge([], { version: "0.9.0" } as Deployment)).toBe("0.9.0");
  });

  it("is the newest tested version when nothing is known to be deployed", () => {
    expect(versionToJudge(runs)).toBe("1.2.0");
    expect(versionToJudge([])).toBeUndefined();
  });
});
