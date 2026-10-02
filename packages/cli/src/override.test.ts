import { describe, expect, it } from "vitest";
import { OVERRIDE_HELP } from "./override.ts";
import { run } from "./run.ts";
import { runWith } from "./testing.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_override" };
const held = {
  id: "0b0b0b0b-8a1b-4c3d-9e0f-123456789abc",
  component: "api",
  environment: "staging",
  version: "3f2a9c1",
  reason: "Hotfix for incident 1234",
  by: "on-call",
  createdAt: "2026-10-02T10:00:00.000Z",
  expiresAt: "2026-10-02T12:00:00.000Z",
  revokedAt: null,
  active: true,
};

function server(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

const create = [
  "override",
  "--component",
  "api",
  "--env",
  "staging",
  "--version",
  "3f2a9c1",
  "--reason",
  "Hotfix for incident 1234",
];

describe("kollaudo override", () => {
  it("lets a version through, and prints the override", async () => {
    const { requests, fetch } = server(201, held);
    const result = await runWith(run, [...create, "--for", "2h"], { env, fetch });

    expect(result).toEqual({
      code: 0,
      out: `${held.id}  api 3f2a9c1 in staging, until 2026-10-02T12:00:00.000Z, by on-call: Hotfix for incident 1234\n`,
      err: "",
    });
    expect(requests[0]?.url).toBe("https://kollaudo.example.com/v1/overrides");
    expect(JSON.parse(requests[0]?.init.body as string)).toEqual({
      component: "api",
      environment: "staging",
      version: "3f2a9c1",
      reason: "Hotfix for incident 1234",
      for: "2h",
    });
  });

  it("lists and revokes overrides", async () => {
    const revoked = { ...held, active: false, revokedAt: "2026-10-02T11:00:00.000Z" };
    const listed = server(200, { items: [revoked] });
    const list = await runWith(run, ["override", "list", "--env", "staging"], {
      env,
      fetch: listed.fetch,
    });
    expect(list.out).toBe(
      `${held.id}  api 3f2a9c1 in staging, revoked 2026-10-02T11:00:00.000Z, by on-call: Hotfix for incident 1234\n`,
    );
    expect(listed.requests[0]?.url).toBe(
      "https://kollaudo.example.com/v1/overrides?environment=staging",
    );

    const revoking = server(200, revoked);
    expect(
      (await runWith(run, ["override", "revoke", held.id], { env, fetch: revoking.fetch })).code,
    ).toBe(0);
    expect(revoking.requests[0]?.url).toBe(
      `https://kollaudo.example.com/v1/overrides/${held.id}/revoke`,
    );
    expect(revoking.requests[0]?.init.method).toBe("POST");
  });

  it("explains what's missing, and a refused token", async () => {
    const missing = await runWith(run, ["override", "--component", "api"], { env });
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/^Missing --env, --version, --reason\./);

    const forbidden = server(403, {
      error: { code: "forbidden", message: "This endpoint needs a token with the override scope." },
    });
    const refused = await runWith(run, create, { env, fetch: forbidden.fetch });
    expect(refused).toMatchObject({
      code: 1,
      err: "Error: This endpoint needs a token with the override scope. (403 forbidden)\n",
    });
  });

  it("shows its help", async () => {
    expect(await runWith(run, ["override", "--help"])).toEqual({
      code: 0,
      out: OVERRIDE_HELP,
      err: "",
    });
  });
});
