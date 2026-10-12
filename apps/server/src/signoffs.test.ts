import { ApiError, Signoff, SignoffList, TestRunDetail, Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let policy: string;
let owner: string;
let limited: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
  policy = (await createProjectToken(testDb.db, "shop", "policy")).token;
  owner = (await createProjectToken(testDb.db, "shop", "signoff", { name: "product-owner" })).token;
  limited = (
    await createProjectToken(testDb.db, "shop", "signoff", {
      name: "qa",
      components: ["checkout"],
      environments: ["staging"],
    })
  ).token;
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const uat = {
  component: "checkout",
  environment: "staging",
  version: "3f2a9c1",
  kind: "uat",
  outcome: "pass",
  note: "Checked the new payment page with the two test cards",
};

async function signoff(body: object, token = owner) {
  const res = await request("POST", "/v1/signoffs", token, { ...uat, ...body });
  expect(res.status).toBe(201);
  return Signoff.parse(await res.json());
}

async function verdict(version = "3f2a9c1", token = read) {
  const res = await request(
    "GET",
    `/v1/verdict?component=checkout&environment=staging&version=${version}`,
    token,
  );
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

async function sendPolicy(source: string) {
  expect((await request("POST", "/v1/policy", policy, { source })).status).toBe(201);
}

async function sendReport(kind: string, status: "passed" | "failed", version = "3f2a9c1") {
  const res = await request("POST", "/v1/test-runs", ingest, {
    component: "checkout",
    environment: "staging",
    version,
    kind,
    report: {
      results: {
        tool: { name: "t" },
        summary: { tests: 1 },
        tests: [{ name: "works", status, duration: 1 }],
      },
    },
  });
  expect(res.status).toBe(201);
}

describe("sign-offs (ADR 0021)", () => {
  it("need a signoff token: pipelines can't sign off their own version", async () => {
    for (const token of [ingest, read, policy]) {
      expect((await request("POST", "/v1/signoffs", token, uat)).status).toBe(403);
    }
  });

  it("respect the limits of the token", async () => {
    const res = await request("POST", "/v1/signoffs", limited, { ...uat, component: "cart" });
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error.code).toBe("outside_token_limits");
    expect(
      (await request("POST", "/v1/signoffs", limited, { ...uat, environment: "production" }))
        .status,
    ).toBe(403);
    expect(await signoff({ version: "limits" }, limited)).toMatchObject({ by: "qa" });
  });

  it("are stored as a test run with one test, and listed with who and when", async () => {
    const created = await signoff({ version: "stored" });
    expect(created).toMatchObject({ ...uat, version: "stored", by: "product-owner" });

    const run = TestRunDetail.parse(
      await (await request("GET", `/v1/test-runs/${created.id}`, read)).json(),
    );
    expect(run).toMatchObject({
      kind: "uat",
      signoff: true,
      note: uat.note,
      sentBy: "product-owner",
    });
    expect(run.summary).toMatchObject({ tests: 1, passed: 1, failed: 0 });
    expect(run.results).toHaveLength(1);

    const listed = SignoffList.parse(
      await (await request("GET", "/v1/signoffs?version=stored", owner)).json(),
    );
    expect(listed.items.map((s) => s.id)).toEqual([created.id]);
  });

  it("are judged like any run when the policy doesn't ask for them", async () => {
    await signoff({ version: "plain", kind: "manual", outcome: "fail", note: "Broken" });
    const v = await verdict("plain", owner);
    expect(v.outcome).toBe("fail");
    expect(v.reasons[0]?.message).toContain("Failed by product-owner");
    expect(v.reasons[0]?.message).toContain(": Broken");
  });

  it("are required by the policy: unknown until one comes, then pass or fail", async () => {
    await sendPolicy("environments:\n  staging:\n    signoff: [uat]\n");

    const waiting = await verdict("required");
    expect(waiting.outcome).toBe("unknown");
    expect(waiting.policy.signoff).toEqual(["uat"]);
    expect(waiting.policy.require).toEqual(["uat"]);
    expect(waiting.reasons[0]).toMatchObject({ kind: "uat", message: "Waiting for a sign-off." });

    await signoff({ version: "required" });
    const passed = await verdict("required");
    expect(passed.outcome).toBe("pass");
    expect(passed.reasons[0]?.message).toMatch(/^Signed off by product-owner at .*: Checked/);
    expect(passed.reasons[0]?.run).toMatchObject({ signoff: true, note: uat.note });

    await signoff({ version: "required", outcome: "fail", note: "The payment page is broken" });
    expect((await verdict("required")).outcome).toBe("fail");

    await signoff({ version: "required", outcome: "pass" });
    expect((await verdict("required")).outcome).toBe("pass");
    const all = SignoffList.parse(
      await (await request("GET", "/v1/signoffs?version=required", read)).json(),
    );
    expect(all.items.map((s) => s.outcome)).toEqual(["pass", "fail", "pass"]);
  });

  it("aren't replaced by a report of the same kind", async () => {
    await sendReport("uat", "passed", "report-only");
    const v = await verdict("report-only");
    expect(v.outcome).toBe("unknown");
    expect(v.reasons[0]?.message).toContain("Waiting for a sign-off");
    expect(v.reasons[0]?.message).toContain("signoff token");

    // A report sent after a sign-off doesn't take its place either.
    await signoff({ version: "report-after", outcome: "fail" });
    await sendReport("uat", "passed", "report-after");
    expect((await verdict("report-after")).outcome).toBe("fail");
  });

  it("win over require: the kind counts only from a signoff token", async () => {
    await sendPolicy("environments:\n  staging:\n    require: [uat]\n    signoff: [uat]\n");
    await sendReport("uat", "passed", "both");
    expect((await verdict("both")).outcome).toBe("unknown");
    await signoff({ version: "both" });
    expect((await verdict("both")).outcome).toBe("pass");
  });

  it("count for maxAge and deployed, like any run", async () => {
    await sendPolicy("environments:\n  staging:\n    signoff: [uat]\n    deployed: true\n");
    await signoff({ version: "not-deployed" });
    const v = await verdict("not-deployed");
    expect(v.outcome).toBe("unknown");
    expect(v.reasons[0]?.message).toContain("before any deployment Kollaudo knows of");

    const deploy = await request("POST", "/v1/deployments", ingest, {
      component: "checkout",
      environment: "staging",
      version: "deployed",
    });
    expect(deploy.status).toBe(201);
    await signoff({ version: "deployed" });
    expect((await verdict("deployed")).outcome).toBe("pass");
  });

  it("make a policy with signoff valid, and an unknown kind name invalid", async () => {
    const ok = await request("POST", "/v1/policy/check", read, {
      source: "default:\n  signoff: [uat]\n",
    });
    expect(ok.status).toBe(200);
    const bad = await request("POST", "/v1/policy/check", read, {
      source: "default:\n  signoff: [UAT]\n",
    });
    expect(bad.status).toBe(400);
  });

  it("can ask for a verdict with a signoff token, and a signoff token can't read test runs", async () => {
    expect((await verdict("stored", owner)).version).toBe("stored");
    expect((await request("GET", "/v1/test-runs", owner)).status).toBe(403);
  });

  it("validate the outcome", async () => {
    const res = await request("POST", "/v1/signoffs", owner, { ...uat, outcome: "maybe" });
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.issues?.[0]?.path).toBe("outcome");
  });
});
