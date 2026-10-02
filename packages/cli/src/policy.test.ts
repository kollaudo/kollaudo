import { describe, expect, it } from "vitest";
import { POLICY_HELP } from "./policy.ts";
import { run } from "./run.ts";
import { runWith } from "./testing.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_policy" };
const source = "# Shop\nenvironments:\n  staging:\n    require: [e2e, smoke]\n";
const files = { "kollaudo.yaml": source };
const stored = {
  revision: 3,
  source,
  document: { environments: { staging: { require: ["e2e", "smoke"] } } },
  sentBy: "rules",
  createdAt: "2026-10-02T10:00:00.000Z",
};

function server(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

describe("kollaudo policy", () => {
  it("pushes the file as it is", async () => {
    const { requests, fetch } = server(201, stored);
    const result = await runWith(run, ["policy", "push", "kollaudo.yaml"], { env, files, fetch });

    expect(result).toEqual({
      code: 0,
      out: "Policy revision 3 applies from now on, sent by rules.\n",
      err: "",
    });
    expect(requests[0]?.url).toBe("https://kollaudo.example.com/v1/policy");
    expect(JSON.parse(requests[0]?.init.body as string)).toEqual({ source });
  });

  it("checks a file, and shows each problem in it", async () => {
    const ok = server(200, { document: stored.document });
    expect(
      await runWith(run, ["policy", "check", "kollaudo.yaml"], { env, files, fetch: ok.fetch }),
    ).toEqual({ code: 0, out: "kollaudo.yaml is a valid policy.\n", err: "" });
    expect(ok.requests[0]?.url).toBe("https://kollaudo.example.com/v1/policy/check");

    const invalid = server(400, {
      error: {
        code: "invalid_policy",
        message: "The policy isn't valid.",
        issues: [
          { path: "environments.staging.require.0", message: "Use kinds such as e2e or smoke." },
        ],
      },
    });
    const result = await runWith(run, ["policy", "check", "kollaudo.yaml"], {
      env,
      files,
      fetch: invalid.fetch,
    });
    expect(result).toMatchObject({
      code: 1,
      err:
        "Error: The policy isn't valid. (400 invalid_policy)\n" +
        "  kollaudo.yaml: environments.staging.require.0: Use kinds such as e2e or smoke.\n",
    });
  });

  it("shows the project's policy with its revision", async () => {
    const { out } = await runWith(run, ["policy", "show"], {
      env,
      fetch: server(200, stored).fetch,
    });
    expect(out).toBe(`# Revision 3, sent by rules on 2026-10-02T10:00:00.000Z\n${source}`);
  });

  it("explains a wrong token, a missing file and a wrong command", async () => {
    const forbidden = server(403, {
      error: { code: "forbidden", message: "This endpoint needs a token with the policy scope." },
    });
    const results = [
      await runWith(run, ["policy", "push", "kollaudo.yaml"], {
        env,
        files,
        fetch: forbidden.fetch,
      }),
      await runWith(run, ["policy", "push", "nope.yaml"], { env, files }),
      await runWith(run, ["policy", "push"], { env, files }),
      await runWith(run, ["policy", "delete"], { env, files }),
    ];
    expect(results.map((r) => r.code)).toEqual([1, 1, 1, 1]);
    expect(results[0]?.err).toBe(
      "Error: This endpoint needs a token with the policy scope. (403 forbidden)\n",
    );
    expect(results[1]?.err).toContain("Can't read nope.yaml");
    expect(results[2]?.err).toContain('Use "kollaudo policy push <file>"');
    expect(results[3]?.err).toContain('Use "kollaudo policy push <file>"');
  });

  it("shows its help", async () => {
    expect(await runWith(run, ["policy", "--help"])).toEqual({
      code: 0,
      out: POLICY_HELP,
      err: "",
    });
  });
});
