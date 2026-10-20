import { Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createProject } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
});
afterAll(() => testDb.drop());

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${ingest}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Test = { name: string; status: string; suite?: string | string[]; flaky?: boolean };

/** Sends a run of "checkout" in staging, where each test takes 10 ms. */
async function push(version: string, tests: Test[], component = "checkout") {
  const res = await post("/v1/test-runs", {
    component,
    version,
    environment: "staging",
    kind: "e2e",
    report: {
      results: {
        tool: { name: "playwright" },
        summary: { tests: tests.length },
        tests: tests.map((t) => ({ ...t, duration: 10 })),
      },
    },
  });
  expect(res.status).toBe(201);
}

async function link(fields: object) {
  const res = await post("/v1/bugs", {
    key: "SHOP-412",
    url: "https://example.atlassian.net/browse/SHOP-412",
    component: "checkout",
    tests: ["checkout › pays with a saved card"],
    ...fields,
  });
  expect(res.status).toBe(200);
}

async function verdict(version: string) {
  const res = await app.request(
    `/v1/verdict?component=checkout&environment=staging&version=${version}&record=false`,
    { headers: { authorization: `Bearer ${read}` } },
  );
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

const card = { name: "pays with a saved card", suite: ["checkout"], status: "failed" };
const coupon = { name: "applies a coupon", suite: ["checkout"], status: "failed" };
const guest = { name: "pays as a guest", suite: ["checkout"], status: "passed" };
const bug = {
  key: "SHOP-412",
  url: "https://example.atlassian.net/browse/SHOP-412",
  state: "open",
};

describe("known bugs in the verdict", () => {
  it("lists a failure with no link as new", async () => {
    await push("1.0.0", [card, guest]);

    const result = await verdict("1.0.0");

    expect(result.outcome).toBe("fail");
    expect(result.reasons[0]).toMatchObject({
      message: "1 failed, 1 passed",
      failures: [{ test: "checkout › pays with a saved card", bug: null }],
    });
    expect(result.unmatchedBugs).toEqual([]);
  });

  it("marks a failure with an open bug as known and still fails", async () => {
    await link({});
    await push("1.1.0", [card, coupon, guest]);

    const result = await verdict("1.1.0");

    expect(result.outcome).toBe("fail");
    expect(result.message).toBe("e2e failed.");
    expect(result.reasons[0]).toMatchObject({
      outcome: "fail",
      message: "2 failed: 1 known (SHOP-412), 1 new; 1 passed",
      failures: [
        { test: "checkout › applies a coupon", bug: null },
        { test: "checkout › pays with a saved card", bug },
      ],
    });
  });

  it("names a test from a suite sent as one string the same way", async () => {
    await push("1.2.0", [{ ...card, suite: "checkout" }]);
    await push("1.2.1", [{ ...card, suite: "a > b" }]);
    await push("1.2.3", [{ ...card, suite: ["a", "b"] }]);

    expect((await verdict("1.2.0")).reasons[0]?.failures).toEqual([
      { test: "checkout › pays with a saved card", bug },
    ]);
    const asString = (await verdict("1.2.1")).reasons[0]?.failures;
    expect(asString).toEqual([{ test: "a › b › pays with a saved card", bug: null }]);
    expect((await verdict("1.2.3")).reasons[0]?.failures).toEqual(asString);
  });

  it("doesn't list a test that passed on retry", async () => {
    await push("1.2.2", [{ ...card, status: "passed", flaky: true }, coupon]);

    const result = await verdict("1.2.2");

    expect(result.reasons[0]).toMatchObject({
      message: "1 failed, 1 passed, 1 flaky",
      failures: [{ test: "checkout › applies a coupon", bug: null }],
    });
  });

  it("lists an open bug whose test didn't fail as not matching", async () => {
    await push("1.3.0", [coupon, guest]);

    const result = await verdict("1.3.0");

    expect(result.reasons[0]?.failures).toEqual([
      { test: "checkout › applies a coupon", bug: null },
    ]);
    expect(result.unmatchedBugs).toEqual([
      {
        key: "SHOP-412",
        url: bug.url,
        test: "checkout › pays with a saved card",
      },
    ]);
  });

  it("lists no unmatched bug when nothing failed", async () => {
    await push("1.4.0", [guest]);

    const result = await verdict("1.4.0");

    expect(result.outcome).toBe("pass");
    expect(result.unmatchedBugs).toEqual([]);
  });

  it("ignores the bugs of another component", async () => {
    await link({ key: "BLOG-1", component: "blog", tests: ["checkout › applies a coupon"] });
    await push("1.5.0", [coupon]);

    expect((await verdict("1.5.0")).reasons[0]?.failures).toEqual([
      { test: "checkout › applies a coupon", bug: null },
    ]);
  });

  it("makes a failure new again once its bug is closed", async () => {
    await link({ state: "closed", tests: [] });

    const result = await verdict("1.1.0");

    expect(result.outcome).toBe("fail");
    expect(result.reasons[0]).toMatchObject({
      message: "2 failed, 1 passed",
      failures: [
        { test: "checkout › applies a coupon", bug: null },
        { test: "checkout › pays with a saved card", bug: null },
      ],
    });
    expect(result.unmatchedBugs).toEqual([]);
  });

  it("reads the answer of a server before 0.5, which has no such fields", () => {
    const parsed = Verdict.parse({
      component: "api",
      environment: "staging",
      version: "1",
      outcome: "unknown",
      message: "Evidence is missing for e2e.",
      policy: {
        name: "default",
        revision: null,
        require: ["e2e"],
        signoff: [],
        deployed: false,
        flaky: "allow",
        maxAge: null,
      },
      reasons: [{ kind: "e2e", outcome: "unknown", message: "Required, but no run.", run: null }],
      deployed: null,
      override: null,
      evidenceOutcome: "unknown",
    });

    expect(parsed.reasons[0]?.failures).toBeUndefined();
    expect(parsed.unmatchedBugs).toBeUndefined();
  });
});
