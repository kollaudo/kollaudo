import { ApiError, Bug, BugList } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let limited: string;
let blogIngest: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
  limited = (
    await createProjectToken(testDb.db, "shop", "ingest", {
      name: "cart-ci",
      components: ["cart"],
    })
  ).token;
  const blog = await createProject(testDb.db, "blog");
  blogIngest = blog.tokens.find((t) => t.scope === "ingest")?.token ?? "";
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token?: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const card = "checkout › pays with a saved card";
const bug = {
  key: "SHOP-412",
  url: "https://example.atlassian.net/browse/SHOP-412",
  component: "checkout",
  tests: [card],
};

async function save(body: object, token = ingest) {
  const res = await request("POST", "/v1/bugs", token, { ...bug, ...body });
  expect(res.status).toBe(200);
  return Bug.parse(await res.json());
}

async function list(query = "", token = read) {
  const res = await request("GET", `/v1/bugs${query}`, token);
  expect(res.status).toBe(200);
  return BugList.parse(await res.json()).items;
}

describe("POST /v1/bugs", () => {
  it("links a bug to a test, open by default", async () => {
    const saved = await save({});
    expect(saved).toMatchObject({
      key: "SHOP-412",
      url: bug.url,
      state: "open",
      component: "checkout",
      tests: [card],
    });
    expect(saved.by).toMatch(/^kol_/);
  });

  it("updates a link instead of repeating it, and adds the other tests of the bug", async () => {
    const other = "checkout › pays with a gift card";
    const url = "https://example.atlassian.net/browse/SHOP-412?moved";
    const saved = await save({ tests: [card, other], url });
    expect(saved.tests.toSorted()).toEqual([other, card].toSorted());
    expect(saved.url).toBe(url);
    expect((await list("?key=SHOP-412")).length).toBe(1);

    // Sending only one test leaves the other link as it is.
    const again = await save({ tests: [card], url });
    expect(again.tests.toSorted()).toEqual([other, card].toSorted());
  });

  it("closes every link of a bug, with or without naming its tests", async () => {
    await save({ key: "SHOP-500", tests: ["cart › adds an item", "cart › removes an item"] });
    const closed = await save({ key: "SHOP-500", state: "closed", tests: [] });
    expect(closed.state).toBe("closed");
    expect(closed.tests).toHaveLength(2);

    expect(await list("?state=open&key=SHOP-500")).toEqual([]);
    expect(await list("?state=closed&key=SHOP-500")).toHaveLength(1);
  });

  it("opens a closed bug again when it is sent as open", async () => {
    const reopened = await save({ key: "SHOP-500", tests: ["cart › adds an item"] });
    expect(reopened.state).toBe("open");
  });

  it("asks for a test to open a bug", async () => {
    const res = await request("POST", "/v1/bugs", ingest, { ...bug, key: "SHOP-1", tests: [] });
    expect(res.status).toBe(400);
  });

  it("refuses a URL that isn't http or https", async () => {
    const res = await request("POST", "/v1/bugs", ingest, { ...bug, url: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });

  it("needs an ingest token", async () => {
    expect((await request("POST", "/v1/bugs", read, bug)).status).toBe(403);
    expect((await request("POST", "/v1/bugs", undefined, bug)).status).toBe(401);
  });

  it("applies the components a token is limited to", async () => {
    const res = await request("POST", "/v1/bugs", limited, bug);
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).error.code).toBe("outside_token_limits");

    const allowed = await request("POST", "/v1/bugs", limited, {
      ...bug,
      key: "SHOP-9",
      component: "cart",
      tests: ["cart › adds an item"],
    });
    expect(allowed.status).toBe(200);
  });
});

describe("GET /v1/bugs", () => {
  it("lists bugs with their tests, to read and ingest tokens", async () => {
    const asRead = await list();
    const asIngest = await list("", ingest);
    expect(asIngest).toEqual(asRead);
    expect(asRead.map((b) => b.key)).toContain("SHOP-412");
  });

  it("filters by component", async () => {
    const items = await list("?component=cart");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((b) => b.component === "cart")).toBe(true);
  });

  it("keeps projects apart", async () => {
    expect(await list("", blogIngest)).toEqual([]);
    const res = await request("POST", "/v1/bugs", blogIngest, bug);
    expect(res.status).toBe(200);
    expect(await list("?key=SHOP-412")).toHaveLength(1);
    expect(await list("?key=SHOP-412", blogIngest)).toHaveLength(1);
  });
});
