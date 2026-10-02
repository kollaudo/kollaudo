import { ApiError, Override, OverrideList, Verdict } from "@kollaudo/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { overrides } from "./db/schema.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let onCall: string;
let otherOnCall: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
  onCall = (await createProjectToken(testDb.db, "shop", "override", { name: "on-call" })).token;
  await createProject(testDb.db, "blog");
  otherOnCall = (await createProjectToken(testDb.db, "blog", "override")).token;
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const hotfix = {
  component: "api",
  environment: "staging",
  version: "1.0.1",
  reason: "Hotfix for incident 1234, e2e environment down",
};

async function verdict(version = "1.0.1") {
  const res = await request(
    "GET",
    `/v1/verdict?component=api&environment=staging&version=${version}&require=e2e`,
    read,
  );
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

describe("overrides (ADR 0018)", () => {
  it("need an override token: pipelines can't override their own gate", async () => {
    for (const token of [ingest, read]) {
      expect((await request("POST", "/v1/overrides", token, hotfix)).status).toBe(403);
    }
  });

  it("need a reason, and hold for 24h at most", async () => {
    const short = await request("POST", "/v1/overrides", onCall, { ...hotfix, reason: "urgent" });
    expect(short.status).toBe(400);
    expect(ApiError.parse(await short.json()).error.issues?.[0]?.path).toBe("reason");

    const long = await request("POST", "/v1/overrides", onCall, { ...hotfix, for: "25h" });
    expect(long.status).toBe(400);
    expect(ApiError.parse(await long.json()).error.code).toBe("override_too_long");
  });

  it("let a version through, and the verdict says so", async () => {
    expect((await verdict()).outcome).toBe("unknown");

    const res = await request("POST", "/v1/overrides", onCall, { ...hotfix, for: "2h" });
    expect(res.status).toBe(201);
    const created = Override.parse(await res.json());
    expect(created).toMatchObject({ ...hotfix, by: "on-call", active: true, revokedAt: null });
    const holds = Date.parse(created.expiresAt) - Date.parse(created.createdAt);
    expect(holds).toBeGreaterThan(2 * 3_600_000 - 5_000);
    expect(holds).toBeLessThanOrEqual(2 * 3_600_000 + 5_000);

    const overridden = await verdict();
    expect(overridden).toMatchObject({
      outcome: "pass",
      evidenceOutcome: "unknown",
      override: { id: created.id, by: "on-call" },
    });
    expect(overridden.message).toMatch(/^Overridden by on-call until .+: Hotfix for incident 1234/);
    // The evidence is still shown as it is.
    expect(overridden.reasons).toEqual([
      { kind: "e2e", outcome: "unknown", message: "Required, but no run.", run: null },
    ]);
    // Other versions keep their gate.
    expect((await verdict("1.0.2")).override).toBeNull();
  });

  it("stop holding when revoked or expired, and stay in the list", async () => {
    const { items } = OverrideList.parse(
      await (await request("GET", "/v1/overrides?component=api", read)).json(),
    );
    const [held] = items;
    expect(items).toHaveLength(1);

    const revoked = await request("POST", `/v1/overrides/${held?.id}/revoke`, onCall);
    expect(revoked.status).toBe(200);
    expect(Override.parse(await revoked.json())).toMatchObject({ active: false });
    expect(await verdict()).toMatchObject({ outcome: "unknown", override: null });

    // An override that expired doesn't hold either.
    const res = await request("POST", "/v1/overrides", onCall, hotfix);
    const second = Override.parse(await res.json());
    await testDb.db
      .update(overrides)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(overrides.id, second.id));
    expect((await verdict()).override).toBeNull();

    const all = OverrideList.parse(await (await request("GET", "/v1/overrides", read)).json());
    expect(all.items.map((o) => [o.id, o.active, o.revokedAt !== null])).toEqual([
      [second.id, false, false],
      [held?.id, false, true],
    ]);
  });

  it("belong to their project", async () => {
    const { items } = OverrideList.parse(
      await (await request("GET", "/v1/overrides", otherOnCall)).json(),
    );
    expect(items).toEqual([]);
    const listed = OverrideList.parse(await (await request("GET", "/v1/overrides", read)).json());
    const res = await request("POST", `/v1/overrides/${listed.items[0]?.id}/revoke`, otherOnCall);
    expect(res.status).toBe(404);
  });
});
