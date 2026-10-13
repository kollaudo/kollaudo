import { describe, expect, it } from "vitest";
import { run } from "./run.ts";
import { SIGNOFF_HELP } from "./signoff.ts";
import { runWith, webPage } from "./testing.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_signoff" };
const given = {
  id: "0b0b0b0b-8a1b-4c3d-9e0f-123456789abc",
  component: "checkout",
  environment: "staging",
  version: "3f2a9c1",
  kind: "uat",
  outcome: "pass",
  note: "Checked the new payment page",
  by: "product-owner",
  createdAt: "2026-10-12T10:00:00.000Z",
};
const run1 = {
  id: given.id,
  component: "checkout",
  version: "3f2a9c1",
  environment: "staging",
  kind: "uat",
  summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0, flaky: 0 },
  commit: null,
  branch: null,
  tag: null,
  pullRequest: null,
  digest: null,
  tool: null,
  signoff: true,
  note: given.note,
  sentBy: "product-owner",
  startedAt: null,
  finishedAt: null,
  createdAt: given.createdAt,
};
const verdict = {
  component: "checkout",
  environment: "staging",
  version: "3f2a9c1",
  outcome: "pass",
  message: "uat passed.",
  policy: {
    name: "project",
    revision: 3,
    require: ["uat"],
    signoff: ["uat"],
    deployed: false,
    flaky: "allow",
    maxAge: null,
  },
  reasons: [
    {
      kind: "uat",
      outcome: "pass",
      message:
        "Signed off by product-owner at 2026-10-12T10:00:00.000Z: Checked the new payment page",
      run: run1,
    },
  ],
  deployed: null,
  override: null,
  evidenceOutcome: "pass",
};

/** Answers the sign-off, then the verdict. */
function server(signoffStatus = 201, signoffBody: unknown = given, verdictStatus = 200) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return String(url).includes("/v1/signoffs")
      ? new Response(JSON.stringify(signoffBody), { status: signoffStatus })
      : new Response(JSON.stringify(verdict), { status: verdictStatus });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

const give = [
  "signoff",
  "--component",
  "checkout",
  "--env",
  "staging",
  "--version",
  "3f2a9c1",
  "--kind",
  "uat",
  "--outcome",
  "pass",
  "--note",
  "Checked the new payment page",
];

describe("kollaudo signoff", () => {
  it("records the sign-off, and prints the verdict that follows", async () => {
    const { requests, fetch } = server();
    const result = await runWith(run, give, { env, fetch });

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    expect(result.out).toMatch(
      /^Signed off checkout 3f2a9c1 in staging: uat pass, by product-owner: Checked the new payment page\n\nPASS {2}checkout 3f2a9c1 in staging: uat passed\.\n/,
    );
    expect(result.out).toContain("Policy revision 3.");
    expect(result.out).toContain("by product-owner");

    expect(requests[0]?.url).toBe("https://kollaudo.example.com/v1/signoffs");
    expect(requests[0]?.init.method).toBe("POST");
    expect(JSON.parse(requests[0]?.init.body as string)).toEqual({
      component: "checkout",
      environment: "staging",
      version: "3f2a9c1",
      kind: "uat",
      outcome: "pass",
      note: "Checked the new payment page",
    });
    // The verdict is not a gate: it isn't recorded in the log.
    expect(requests[1]?.url).toBe(
      "https://kollaudo.example.com/v1/verdict?component=checkout&environment=staging&version=3f2a9c1&record=false",
    );
  });

  it("exits with 0 whatever the verdict is", async () => {
    const { fetch } = server(201, { ...given, outcome: "fail" });
    const result = await runWith(run, [...give.slice(0, -4), "--outcome", "fail"], { env, fetch });
    expect(result.code).toBe(0);
  });

  it("prints JSON with --json", async () => {
    const { fetch } = server();
    const result = await runWith(run, [...give, "--json"], { env, fetch });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ signoff: given, verdict });
  });

  it("explains what's missing, and an outcome that isn't pass or fail", async () => {
    const missing = await runWith(run, ["signoff", "--component", "checkout"], { env });
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/^Missing --env, --version, --kind, --outcome\./);

    const maybe = await runWith(run, [...give.slice(0, -4), "--outcome", "maybe"], { env });
    expect(maybe).toEqual({ code: 1, out: "", err: "Error: --outcome must be pass or fail.\n" });

    const noUrl = await runWith(run, give, { env: {} });
    expect(noUrl.err).toBe("Error: Set KOLLAUDO_URL to the URL of your Kollaudo server.\n");
    const noToken = await runWith(run, give, { env: { KOLLAUDO_URL: env.KOLLAUDO_URL } });
    expect(noToken.err).toBe(
      "Error: Set KOLLAUDO_TOKEN to a token of the signoff scope of your project.\n",
    );
  });

  it("explains a refused token, and a server that answers with a page", async () => {
    const forbidden = server(403, {
      error: { code: "forbidden", message: "This endpoint needs a token with the signoff scope." },
    });
    expect(await runWith(run, give, { env, fetch: forbidden.fetch })).toMatchObject({
      code: 1,
      out: "",
      err: "Error: This endpoint needs a token with the signoff scope. (403 forbidden)\n",
    });

    const page = await runWith(run, give, { env, fetch: webPage });
    expect(page.code).toBe(1);
    expect(page.err).toContain("answered with a page, not with JSON");
  });

  it("says that the sign-off is recorded when the verdict can't be read", async () => {
    const { fetch } = server(201, given, 500);
    const result = await runWith(run, give, { env, fetch });
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toMatch(
      /^Error: The sign-off is recorded, but the verdict can't be read\. Kollaudo answered 500/,
    );
  });

  it("shows its help, and the command in the list", async () => {
    expect(await runWith(run, ["signoff", "--help"])).toEqual({
      code: 0,
      out: SIGNOFF_HELP,
      err: "",
    });
    expect((await runWith(run, ["--help"])).out).toContain("signoff ");
  });
});
