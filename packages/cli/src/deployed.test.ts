import { describe, expect, it } from "vitest";
import { DEPLOYED_HELP } from "./deployed.ts";
import { run } from "./run.ts";
import { runWith, webPage } from "./testing.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_ingest" };
const args = ["deployed", "--component", "api", "--env", "staging", "--version", "3f2a9c1"];

const recorded = {
  id: "4f5c2d7e-8a1b-4c3d-9e0f-123456789abc",
  component: "api",
  environment: "staging",
  version: "3f2a9c1",
  commit: null,
  branch: null,
  tag: null,
  pullRequest: null,
  digest: "sha256:aaa",
  tool: "helm",
  deployedAt: "2026-10-01T07:00:00.000Z",
  createdAt: "2026-10-01T07:00:01.000Z",
  gate: null,
};

/** A fake server that records the requests and answers with the given status and body. */
function server(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

describe("kollaudo deployed", () => {
  it("records the deployment", async () => {
    const { requests, fetch } = server(201, recorded);
    const result = await runWith(
      run,
      [...args, "--tool", "helm", "--digest", "sha256:aaa", "--at", "2026-10-01T09:00:00+02:00"],
      { env, fetch },
    );

    expect(result).toEqual({
      code: 0,
      out: "Recorded api 3f2a9c1 running in staging since 2026-10-01T07:00:00.000Z (helm)\n",
      err: "",
    });
    const [{ url, init }] = requests as [(typeof requests)[number]];
    expect(url).toBe("https://kollaudo.example.com/v1/deployments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      component: "api",
      environment: "staging",
      version: "3f2a9c1",
      deployedAt: "2026-10-01T07:00:00.000Z",
      tool: "helm",
      digest: "sha256:aaa",
    });
  });

  it("leaves the time to the server when --at isn't given", async () => {
    const { requests, fetch } = server(201, { ...recorded, tool: null });
    const { out } = await runWith(run, args, { env, fetch });

    expect(out).toBe("Recorded api 3f2a9c1 running in staging since 2026-10-01T07:00:00.000Z\n");
    expect(JSON.parse(requests[0]?.init.body as string)).not.toHaveProperty("deployedAt");
  });

  it("says when the deployment went around the gate", async () => {
    const gate = { from: "staging", verdictId: null, passedAt: null };
    const ungated = server(201, { ...recorded, gate: { ...gate, gated: false } });
    const gated = server(201, {
      ...recorded,
      gate: {
        ...gate,
        gated: true,
        verdictId: "0d0d0d0d-8a1b-4c3d-9e0f-123456789abc",
        passedAt: "2026-10-01T06:50:00.000Z",
      },
    });

    const warned = await runWith(run, args, { env, fetch: ungated.fetch });
    expect(warned).toEqual({
      code: 0,
      out:
        "Recorded api 3f2a9c1 running in staging since 2026-10-01T07:00:00.000Z (helm)\n" +
        "Ungated: Kollaudo gave no pass for 3f2a9c1 in staging before it was deployed.\n",
      err: "",
    });
    expect((await runWith(run, args, { env, fetch: gated.fetch })).out).not.toContain("Ungated");
  });

  it("explains errors", async () => {
    const conflict = {
      error: {
        code: "version_conflict",
        message: 'Version "3f2a9c1" of "api" already has digest "sha256:aaa".',
      },
    };
    const results = [
      await runWith(run, args, { env, fetch: server(409, conflict).fetch }),
      await runWith(run, [...args, "--at", "yesterday"], { env }),
      await runWith(run, ["deployed", "--component", "api"], { env }),
      await runWith(run, args, { env: {} }),
      await runWith(run, args, { env, fetch: webPage }),
    ];

    expect(results.map((r) => r.code)).toEqual([1, 1, 1, 1, 1]);
    expect(results[0]?.err).toBe(
      'Error: Version "3f2a9c1" of "api" already has digest "sha256:aaa". (409 version_conflict)\n',
    );
    expect(results[1]?.err).toBe("Error: --at isn't a date and time: yesterday\n");
    expect(results[2]?.err).toMatch(/^Missing --env and --version\.\n\nUsage: kollaudo deployed/);
    expect(results[3]?.err).toBe("Error: Set KOLLAUDO_URL to the URL of your Kollaudo server.\n");
    expect(results[4]?.err).toBe(
      "Error: Kollaudo at https://kollaudo.example.com answered with a page, not with JSON. Is KOLLAUDO_URL the address of the Kollaudo server?\n",
    );
  });

  it("shows its help", async () => {
    expect(await runWith(run, ["deployed", "--help"])).toEqual({
      code: 0,
      out: DEPLOYED_HELP,
      err: "",
    });
  });
});

describe("kollaudo deployed list", () => {
  const readEnv = { ...env, KOLLAUDO_TOKEN: "kol_read" };

  it("lists deployments with their time, component, version, environment and tool", async () => {
    const { requests, fetch } = server(200, {
      items: [recorded, { ...recorded, version: "3f2a9c0", tool: null }],
      next: null,
    });

    expect(await runWith(run, ["deployed", "list"], { env: readEnv, fetch })).toEqual({
      code: 0,
      out:
        "2026-10-01T07:00:00.000Z  api 3f2a9c1 in staging (helm)\n" +
        "2026-10-01T07:00:00.000Z  api 3f2a9c0 in staging\n",
      err: "",
    });
    expect(requests[0]?.url).toBe("https://kollaudo.example.com/v1/deployments");
    expect(requests[0]?.init.method).toBe("GET");
    expect(requests[0]?.init.body).toBeUndefined();
    expect(requests[0]?.init.headers).toMatchObject({ authorization: "Bearer kol_read" });
  });

  it.each([
    [[], ""],
    [["--component", "api"], "?component=api"],
    [["--env", "staging"], "?environment=staging"],
    [["--version", "release/v1+build"], "?version=release%2Fv1%2Bbuild"],
    [
      ["--component", "api", "--env", "staging", "--version", "3f2a9c1"],
      "?component=api&environment=staging&version=3f2a9c1",
    ],
  ])("lists with optional filters: %j", async (filters, query) => {
    const { requests, fetch } = server(200, { items: [], next: null });
    expect(
      await runWith(run, ["deployed", "list", ...(filters as string[])], { env: readEnv, fetch }),
    ).toEqual({ code: 0, out: "No deployments.\n", err: "" });
    expect(requests[0]?.url).toBe(`https://kollaudo.example.com/v1/deployments${query}`);
  });

  it("prints the unchanged JSON response, including the next cursor and extra fields", async () => {
    const text = `{ "items": [${JSON.stringify(recorded)}], "next": "${recorded.id}", "extra": "kept" }`;
    const requests: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(text);
    };

    expect(
      await runWith(run, ["deployed", "list", "--env", "staging", "--json"], {
        env: readEnv,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).toEqual({ code: 0, out: `${text}\n`, err: "" });
    expect(requests).toEqual(["https://kollaudo.example.com/v1/deployments?environment=staging"]);
  });

  it.each([false, true])("reports API errors with JSON mode %j", async (json) => {
    const refused = server(403, {
      error: { code: "forbidden", message: "This endpoint needs a token with the read scope." },
    });
    expect(
      await runWith(run, ["deployed", "list", ...(json ? ["--json"] : [])], {
        env: readEnv,
        fetch: refused.fetch,
      }),
    ).toEqual({
      code: 1,
      out: "",
      err: "Error: This endpoint needs a token with the read scope. (403 forbidden)\n",
    });
  });

  it("explains connection and non-JSON errors", async () => {
    const unreachable = await runWith(run, ["deployed", "list"], { env: readEnv });
    expect(unreachable).toEqual({
      code: 1,
      out: "",
      err: "Error: Can't reach Kollaudo at https://kollaudo.example.com: No network in tests\n",
    });
    expect(await runWith(run, ["deployed", "list"], { env: readEnv, fetch: webPage })).toEqual({
      code: 1,
      out: "",
      err: "Error: Kollaudo at https://kollaudo.example.com answered with a page, not with JSON. Is KOLLAUDO_URL the address of the Kollaudo server?\n",
    });
  });

  it("requires a server URL and a read token", async () => {
    const { requests, fetch } = server(200, { items: [], next: null });
    const noUrl = await runWith(run, ["deployed", "list"], { fetch });
    const noToken = await runWith(run, ["deployed", "list"], {
      env: { KOLLAUDO_URL: env.KOLLAUDO_URL },
      fetch,
    });

    expect(noUrl).toEqual({
      code: 1,
      out: "",
      err: "Error: Set KOLLAUDO_URL to the URL of your Kollaudo server.\n",
    });
    expect(noToken).toEqual({
      code: 1,
      out: "",
      err: "Error: Set KOLLAUDO_TOKEN to a read token of your project.\n",
    });
    expect(requests).toEqual([]);
  });

  it("shows help without calling the server, and rejects unsupported options", async () => {
    const { requests, fetch } = server(200, { items: [], next: null });
    const help = await runWith(run, ["deployed", "list", "--help"], { fetch });
    expect(help.code).toBe(0);
    expect(help.err).toBe("");
    expect(help.out).toContain("Usage: kollaudo deployed list");
    expect(help.out).toContain("--json");

    const invalid = await runWith(run, ["deployed", "list", "--tool", "helm"], {
      env: readEnv,
      fetch,
    });
    expect(invalid.code).toBe(1);
    expect(invalid.err).toContain("Unknown option '--tool'");
    expect(requests).toEqual([]);
  });
});
