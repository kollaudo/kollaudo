import { GivenVerdictList, Verdict } from "@kollaudo/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { verdicts } from "./db/schema.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let kargo: string;
let other: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
  kargo = (await createProjectToken(testDb.db, "shop", "read", { name: "kargo" })).token;
  other = (await createProjectToken(testDb.db, "shop", "read", { name: "other-gate" })).token;
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function ask(version: string, token = kargo) {
  const res = await request(
    "GET",
    `/v1/verdict?component=api&environment=staging&version=${version}&require=e2e`,
    token,
  );
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

async function log(version: string) {
  const res = await request("GET", `/v1/verdicts?version=${version}`, read);
  return GivenVerdictList.parse(await res.json()).items;
}

describe("repeated answers in the log of verdicts", () => {
  it("count as one entry while a gate waits and gets the same answer", async () => {
    for (let i = 0; i < 5; i++) expect((await ask("1.0.0")).outcome).toBe("unknown");

    const [entry, ...rest] = await log("1.0.0");
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ outcome: "unknown", asked: 5, askedBy: "kargo" });
    expect(Date.parse(entry?.lastAskedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(entry?.createdAt ?? ""),
    );
  });

  it("start a new entry when the answer changes, so the log shows when it did", async () => {
    await ask("1.1.0");
    await ask("1.1.0");
    const res = await request("POST", "/v1/test-runs", ingest, {
      component: "api",
      version: "1.1.0",
      environment: "staging",
      report: {
        results: {
          tool: { name: "playwright" },
          summary: { tests: 1 },
          tests: [{ name: "home", status: "passed", duration: 10 }],
        },
      },
    });
    expect(res.status).toBe(201);
    await ask("1.1.0");

    expect((await log("1.1.0")).map((v) => [v.outcome, v.asked])).toEqual([
      ["pass", 1],
      ["unknown", 2],
    ]);
  });

  it("are counted for each token apart", async () => {
    await ask("1.2.0");
    await ask("1.2.0", other);
    await ask("1.2.0");

    const entries = await log("1.2.0");
    expect(entries.map((v) => [v.askedBy, v.asked]).sort()).toEqual([
      ["kargo", 2],
      ["other-gate", 1],
    ]);
  });

  it("start a new entry after ten minutes without asking", async () => {
    await ask("1.3.0");
    const [first] = await log("1.3.0");
    // As if the gate had last asked a quarter of an hour ago.
    await testDb.db
      .update(verdicts)
      .set({ lastAskedAt: new Date(Date.now() - 15 * 60_000) })
      .where(eq(verdicts.id, first?.id ?? ""));
    await ask("1.3.0");

    expect((await log("1.3.0")).map((v) => v.asked)).toEqual([1, 1]);
  });
});
