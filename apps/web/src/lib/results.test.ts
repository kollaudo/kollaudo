import type { Bug, Deployment, TestResult, TestRun, Verdict } from "@kollaudo/schema";
import { describe, expect, it } from "vitest";
import {
  bugsByTest,
  groupBySuite,
  knownBugs,
  outcome,
  sortEnvironments,
  testName,
  versionToJudge,
} from "./results.ts";

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

  it("knows quality environments, by short and long name", () => {
    expect(sortEnvironments(["prod", "qua", "dev"])).toEqual(["dev", "qua", "prod"]);
    expect(sortEnvironments(["production", "quality", "developing", "canary"])).toEqual([
      "developing",
      "quality",
      // Not known, so after the known ones before production; alphabetically it would come first.
      "canary",
      "production",
    ]);
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

describe("testName", () => {
  it("joins the suite and the name as the links to bugs do", () => {
    expect(testName(result("pays", "failed", ["checkout", "cart"]))).toBe("checkout › cart › pays");
    expect(testName(result("pays", "failed", []))).toBe("pays");
  });
});

const bug = (fields: Partial<Bug>): Bug => ({
  key: "SHOP-412",
  url: "https://example.atlassian.net/browse/SHOP-412",
  state: "open",
  component: "checkout",
  tests: ["checkout › pays"],
  by: null,
  updatedAt: "2026-10-20T09:00:00.000Z",
  ...fields,
});

describe("bugsByTest", () => {
  it("maps the tests of the open bugs and leaves out the closed ones", () => {
    const byTest = bugsByTest([
      bug({ tests: ["checkout › pays", "checkout › refunds"] }),
      bug({ key: "SHOP-1", url: "https://example.com/1", tests: ["checkout › pays"] }),
      bug({ key: "SHOP-9", state: "closed", tests: ["checkout › refunds", "checkout › tips"] }),
    ]);

    expect(byTest.get("checkout › pays")?.map((b) => b.key)).toEqual(["SHOP-412", "SHOP-1"]);
    expect(byTest.get("checkout › refunds")?.map((b) => b.key)).toEqual(["SHOP-412"]);
    expect(byTest.has("checkout › tips")).toBe(false);
  });
});

function verdictOf(outcome: Verdict["outcome"], reasons: Verdict["reasons"]): Verdict {
  return {
    component: "checkout",
    environment: "qa",
    version: "2.0.0",
    outcome,
    message: "e2e failed.",
    policy: {
      name: "default",
      revision: null,
      require: [],
      signoff: [],
      deployed: false,
      flaky: "allow",
      maxAge: null,
    },
    reasons,
    deployed: null,
    override: null,
    evidenceOutcome: outcome,
  };
}

const known = { key: "SHOP-412", url: "https://example.com/412", state: "open" as const };
const failing = (kind: string, failures: NonNullable<Verdict["reasons"][number]["failures"]>) => ({
  kind,
  outcome: "fail" as const,
  message: `${failures.length} failed`,
  run: null,
  failures,
});

describe("knownBugs", () => {
  it("gives the bugs when every failure has one", () => {
    const verdict = verdictOf("fail", [
      failing("e2e", [{ test: "a", bug: known }]),
      failing("smoke", [
        { test: "b", bug: known },
        { test: "c", bug: { ...known, key: "SHOP-7" } },
      ]),
    ]);

    expect(knownBugs(verdict)).toEqual(["SHOP-412", "SHOP-7"]);
  });

  it("is undefined as soon as one failure is new", () => {
    const verdict = verdictOf("fail", [
      failing("e2e", [
        { test: "a", bug: known },
        { test: "b", bug: null },
      ]),
    ]);

    expect(knownBugs(verdict)).toBeUndefined();
  });

  it("is undefined when a failed kind lists no test, or the server doesn't list any", () => {
    expect(knownBugs(verdictOf("fail", [failing("uat", [])]))).toBeUndefined();
    const old = { kind: "e2e", outcome: "fail" as const, message: "1 failed", run: null };
    expect(knownBugs(verdictOf("fail", [old]))).toBeUndefined();
  });

  it("is undefined when nothing failed", () => {
    const passing = { kind: "e2e", outcome: "pass" as const, message: "1 passed", run: null };
    expect(knownBugs(verdictOf("pass", [passing]))).toBeUndefined();
  });

  it("still gives the bugs under an override, which lets the version through", () => {
    const verdict = {
      ...verdictOf("pass", [failing("e2e", [{ test: "a", bug: known }])]),
      evidenceOutcome: "fail" as const,
    };

    expect(knownBugs(verdict)).toEqual(["SHOP-412"]);
  });
});
