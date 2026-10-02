import { ApiError, Deployment, TestRunDetail, Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";
import { matches } from "./tokens.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let read: string;
let limited: string;
let unnamed: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const shop = await createProject(testDb.db, "shop");
  read = shop.tokens.find((t) => t.scope === "read")?.token ?? "";
  unnamed = shop.tokens.find((t) => t.scope === "ingest")?.token ?? "";
  limited = (
    await createProjectToken(testDb.db, "shop", "ingest", {
      name: "ci-staging",
      components: ["api", "web-*"],
      environments: ["staging", "pr-*"],
    })
  ).token;
});
afterAll(() => testDb.drop());

const report = {
  results: {
    tool: { name: "playwright" },
    summary: { tests: 1 },
    tests: [{ name: "works", status: "passed", duration: 1 }],
  },
};

function post(path: string, body: unknown, token: string) {
  return app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  const res = await app.request(path, { headers: { authorization: `Bearer ${read}` } });
  expect(res.status).toBe(200);
  return res.json();
}

describe("limited ingest tokens (ADR 0017)", () => {
  it("send data within their limits, by name or pattern", async () => {
    for (const [component, environment] of [
      ["api", "staging"],
      ["web-shop", "pr-42"],
    ]) {
      const run = await post(
        "/v1/test-runs",
        { component, environment, version: "1", report },
        limited,
      );
      expect(run.status).toBe(201);
      const deployment = await post(
        "/v1/deployments",
        { component, environment, version: "1" },
        limited,
      );
      expect(deployment.status).toBe(201);
    }
  });

  it("are refused outside their limits, and for build-level runs", async () => {
    const cases = [
      ["/v1/test-runs", { component: "billing", environment: "staging", version: "1", report }],
      ["/v1/test-runs", { component: "api", environment: "production", version: "1", report }],
      ["/v1/test-runs", { component: "api", version: "1", kind: "unit", report }],
      ["/v1/deployments", { component: "api", environment: "production", version: "1" }],
    ] as const;
    const messages = [];
    for (const [path, body] of cases) {
      const res = await post(path, body, limited);
      expect(res.status).toBe(403);
      const { error } = ApiError.parse(await res.json());
      expect(error.code).toBe("outside_token_limits");
      messages.push(error.message);
    }
    expect(messages).toEqual([
      'This token can\'t send data for the component "billing": it is limited to api, web-*.',
      'This token can\'t send data for the environment "production": it is limited to staging, pr-*.',
      "This token can't send build-level runs: it is limited to environments.",
      'This token can\'t send data for the environment "production": it is limited to staging, pr-*.',
    ]);
  });

  it("don't limit tokens created without limits", async () => {
    const res = await post(
      "/v1/test-runs",
      { component: "billing", version: "1", kind: "unit", report },
      unnamed,
    );
    expect(res.status).toBe(201);
  });
});

describe("who sent the evidence (ADR 0017)", () => {
  it("is recorded with test runs, deployments and the reasons of the verdict", async () => {
    const created = await post(
      "/v1/test-runs",
      { component: "api", environment: "staging", version: "2", report },
      limited,
    );
    const { id } = (await created.json()) as { id: string };
    const run = TestRunDetail.parse(await get(`/v1/test-runs/${id}`));
    expect(run.sentBy).toBe("ci-staging");

    const deployment = Deployment.parse(
      await (
        await post(
          "/v1/deployments",
          { component: "api", environment: "staging", version: "2" },
          unnamed,
        )
      ).json(),
    );
    // A token without a name shows the start of the token.
    expect(deployment.sentBy).toBe(`${unnamed.slice(0, 8)}…`);

    const verdict = Verdict.parse(
      await get("/v1/verdict?component=api&environment=staging&version=2"),
    );
    expect(verdict.reasons[0]?.run?.sentBy).toBe("ci-staging");
  });
});

describe("matches", () => {
  it("matches names and * patterns, and nothing else", () => {
    expect(matches("api", "api")).toBe(true);
    expect(matches("api", "api-2")).toBe(false);
    expect(matches("pr-*", "pr-42")).toBe(true);
    expect(matches("pr-*", "pr-")).toBe(true);
    expect(matches("pr-*", "xpr-42")).toBe(false);
    expect(matches("team/*", "team/api")).toBe(true);
    // Dots and other characters are literal.
    expect(matches("a.b", "axb")).toBe(false);
    expect(matches("*", "anything")).toBe(true);
  });
});
