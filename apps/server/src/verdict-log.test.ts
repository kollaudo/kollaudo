import { GivenVerdictList, Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { components, versions } from "./db/schema.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let gate: string;
let otherRead: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
  gate = (await createProjectToken(testDb.db, "shop", "read", { name: "kargo" })).token;
  const blog = await createProject(testDb.db, "blog");
  otherRead = blog.tokens.find((t) => t.scope === "read")?.token ?? "";

  const policy = (await createProjectToken(testDb.db, "shop", "policy")).token;
  expect(
    (
      await request("POST", "/v1/policy", policy, {
        source: "environments:\n  staging:\n    require: [e2e]\n",
      })
    ).status,
  ).toBe(201);
  // 1.0.0 passed e2e in staging; 1.1.0 failed it.
  await push("1.0.0", "passed");
  await push("1.1.0", "failed");
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function push(version: string, status: string) {
  const res = await request("POST", "/v1/test-runs", ingest, {
    component: "api",
    version,
    environment: "staging",
    report: {
      results: {
        tool: { name: "playwright" },
        summary: { tests: 1 },
        tests: [{ name: "home", status, duration: 10 }],
      },
    },
  });
  expect(res.status).toBe(201);
}

async function ask(query: string, token = gate) {
  const res = await request("GET", `/v1/verdict?${query}`, token);
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

async function given(query = "", token = read) {
  const res = await request("GET", `/v1/verdicts${query}`, token);
  expect(res.status).toBe(200);
  return GivenVerdictList.parse(await res.json());
}

describe("the log of verdicts (ADR 0019)", () => {
  it("records each verdict as it was given, with the token that asked", async () => {
    await ask("component=api&environment=staging&version=1.0.0");
    await ask("component=api&environment=staging&version=1.1.0&require=smoke", ingest);

    const { items, next } = await given();
    expect(next).toBeNull();
    expect(items).toMatchObject([
      {
        component: "api",
        environment: "staging",
        version: "1.1.0",
        outcome: "fail",
        evidenceOutcome: "fail",
        message: "e2e failed. Evidence is missing for smoke.",
        policyRevision: 1,
        require: ["e2e", "smoke"],
        overrideId: null,
        askedBy: expect.stringMatching(/^kol_.+…$/),
      },
      {
        version: "1.0.0",
        outcome: "pass",
        message: "e2e passed.",
        policyRevision: 1,
        require: ["e2e"],
        askedBy: "kargo",
      },
    ]);
  });

  it("records verdicts on versions Kollaudo has never seen, without creating them", async () => {
    await ask("component=web&environment=production&version=9.9.9");
    const [entry] = (await given("?component=web")).items;
    expect(entry).toMatchObject({ version: "9.9.9", outcome: "unknown", policyRevision: 1 });
    expect(await testDb.db.select().from(components)).toHaveLength(1);
    expect(await testDb.db.select().from(versions)).toHaveLength(2);
  });

  it("records the override that let a version through, and what the evidence said", async () => {
    const onCall = (await createProjectToken(testDb.db, "shop", "override", { name: "on-call" }))
      .token;
    const res = await request("POST", "/v1/overrides", onCall, {
      component: "api",
      environment: "staging",
      version: "1.1.0",
      reason: "Hotfix for incident 1234, e2e environment down",
    });
    const override = (await res.json()) as { id: string };

    await ask("component=api&environment=staging&version=1.1.0");
    const [entry] = (await given("?version=1.1.0")).items;
    expect(entry).toMatchObject({
      outcome: "pass",
      evidenceOutcome: "fail",
      overrideId: override.id,
      askedBy: "kargo",
    });
  });

  it("filters, and pages through older verdicts", async () => {
    expect((await given("?outcome=pass&version=1.0.0")).items).toHaveLength(1);
    expect((await given("?environment=dev")).items).toEqual([]);

    const first = await given("?limit=2");
    expect(first.items).toHaveLength(2);
    expect(first.next).toBe(first.items[1]?.id);
    const second = await given(`?limit=2&before=${first.next}`);
    expect(second.items.map((v) => v.id)).not.toContain(first.items[0]?.id);
    const all = (await given()).items.map((v) => v.id);
    expect([...first.items, ...second.items].map((v) => v.id)).toEqual(all.slice(0, 4));
  });

  it("doesn't record requests that get no verdict", async () => {
    const before = (await given()).items.length;
    expect(
      (await request("GET", "/v1/verdict?component=api&environment=staging", gate)).status,
    ).toBe(400);
    expect((await given()).items).toHaveLength(before);
  });

  it("is read with a read token, and only in its project", async () => {
    expect((await request("GET", "/v1/verdicts", ingest)).status).toBe(403);
    expect((await given("", otherRead)).items).toEqual([]);
  });
});
