import { expect, test } from "@playwright/test";

// The tests of "the app under test". run.sh sends their CTRF report to Kollaudo, and checks the verdict.

test("answers the health check", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ status: "ok" });
});

test("publishes the OpenAPI document", async ({ request }) => {
  const res = await request.get("/v1/openapi.json");
  expect(res.ok()).toBe(true);
  const { paths } = await res.json();
  expect(Object.keys(paths)).toEqual(expect.arrayContaining(["/v1/test-runs", "/v1/verdict"]));
});

test("asks for a token", async ({ request }) => {
  const res = await request.get("/v1/health");
  expect(res.status()).toBe(401);
});

test("serves the web UI on every route", async ({ request }) => {
  for (const path of ["/", "/projects", "/test-runs/00000000-0000-0000-0000-000000000000"]) {
    const res = await request.get(path);
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain('<div id="root">');
  }
});
