import type { Verdict } from "@kollaudo/schema";
import { describe, expect, it } from "vitest";
import { run } from "./run.ts";
import { runWith } from "./testing.ts";
import { VERDICT_HELP } from "./verdict.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_ingest" };
const args = ["verdict", "--component", "api", "--env", "staging", "--version", "1.1.0"];

const e2e = {
  id: "4f5c2d7e-8a1b-4c3d-9e0f-123456789abc",
  component: "api",
  version: "1.1.0",
  environment: "staging",
  kind: "e2e",
  summary: { tests: 1, passed: 1, failed: 0, skipped: 0, pending: 0, other: 0, flaky: 0 },
  commit: null,
  branch: null,
  tag: null,
  pullRequest: null,
  digest: null,
  tool: "playwright",
  sentBy: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-09-30T07:00:00.000Z",
};

function verdict(fields: Partial<Verdict>): Verdict {
  return {
    component: "api",
    environment: "staging",
    version: "1.1.0",
    outcome: "pass",
    message: "e2e passed.",
    policy: {
      name: "default",
      revision: null,
      require: [],
      deployed: false,
      flaky: "allow",
      maxAge: null,
    },
    reasons: [{ kind: "e2e", outcome: "pass", message: "1 passed", run: e2e }],
    deployed: null,
    override: null,
    evidenceOutcome: fields.outcome ?? "pass",
    ...fields,
  };
}

/** A fake server that records the requested URLs and answers with the given status and body. */
function server(status: number, body: unknown) {
  const urls: string[] = [];
  const fetch = async (url: string | URL | Request) => {
    urls.push(String(url));
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { urls, fetch: fetch as typeof globalThis.fetch };
}

describe("kollaudo verdict", () => {
  it("prints the verdict and exits with 0 on pass", async () => {
    const { urls, fetch } = server(200, verdict({}));
    const result = await runWith(run, [...args, "--require", "e2e,smoke"], { env, fetch });

    expect(result).toEqual({
      code: 0,
      out:
        "PASS  api 1.1.0 in staging: e2e passed.\n\n" +
        `  pass     e2e  1 passed  https://kollaudo.example.com/test-runs/${e2e.id}\n`,
      err: "",
    });
    expect(urls).toEqual([
      "https://kollaudo.example.com/v1/verdict?component=api&environment=staging&version=1.1.0&require=e2e%2Csmoke",
    ]);
  });

  it("exits with 1 on fail and 2 on unknown", async () => {
    const failed = verdict({
      outcome: "fail",
      message: "smoke failed. Evidence is missing for uat.",
      reasons: [
        { kind: "smoke", outcome: "fail", message: "1 failed", run: { ...e2e, kind: "smoke" } },
        { kind: "uat", outcome: "unknown", message: "Required, but no run.", run: null },
      ],
    });
    const result = await runWith(run, args, { env, fetch: server(200, failed).fetch });
    expect(result.code).toBe(1);
    expect(result.out).toBe(
      "FAIL  api 1.1.0 in staging: smoke failed. Evidence is missing for uat.\n\n" +
        `  fail     smoke  1 failed  https://kollaudo.example.com/test-runs/${e2e.id}\n` +
        "  unknown  uat    Required, but no run.\n",
    );

    const unknown = verdict({
      outcome: "unknown",
      message: "No test run of this version in this environment.",
      reasons: [],
    });
    const none = await runWith(run, args, { env, fetch: server(200, unknown).fetch });
    expect(none).toMatchObject({
      code: 2,
      out: "UNKNOWN  api 1.1.0 in staging: No test run of this version in this environment.\n",
    });
  });

  it("says when an override lets the version through", async () => {
    const overridden = verdict({
      outcome: "pass",
      message: "Overridden by on-call until 2026-10-02T14:00:00.000Z: Hotfix for incident 1234",
      evidenceOutcome: "unknown",
      reasons: [{ kind: "e2e", outcome: "unknown", message: "Required, but no run.", run: null }],
      override: {
        id: "0b0b0b0b-8a1b-4c3d-9e0f-123456789abc",
        component: "api",
        environment: "staging",
        version: "1.1.0",
        reason: "Hotfix for incident 1234",
        by: "on-call",
        createdAt: "2026-10-02T10:00:00.000Z",
        expiresAt: "2026-10-02T14:00:00.000Z",
        revokedAt: null,
        active: true,
      },
    });
    const { code, out } = await runWith(run, args, { env, fetch: server(200, overridden).fetch });

    expect(code).toBe(0);
    expect(out).toMatch(
      /^PASS \(override\) {2}api 1\.1\.0 in staging: Overridden by on-call until .+: Hotfix for incident 1234\nThe evidence alone is unknown\.\n/,
    );
  });

  it("says who sent each run", async () => {
    const sent = verdict({
      reasons: [
        {
          kind: "e2e",
          outcome: "pass",
          message: "1 passed",
          run: { ...e2e, sentBy: "ci-staging" },
        },
      ],
    });
    const { out } = await runWith(run, args, { env, fetch: server(200, sent).fetch });

    expect(out).toContain(
      `  pass     e2e  1 passed  by ci-staging  https://kollaudo.example.com/test-runs/${e2e.id}\n`,
    );
  });

  it("notes when another version runs in the environment", async () => {
    const deployment = {
      id: "7a7a7a7a-8a1b-4c3d-9e0f-123456789abc",
      component: "api",
      environment: "staging",
      commit: null,
      branch: null,
      tag: null,
      pullRequest: null,
      digest: null,
      tool: "argocd",
      sentBy: null,
      createdAt: "2026-10-01T07:00:00.000Z",
      deployedAt: "2026-10-01T07:00:00.000Z",
      gate: null,
    };
    const other = verdict({ deployed: { ...deployment, version: "1.2.0" } });
    const same = verdict({ deployed: { ...deployment, version: "1.1.0" } });

    const withNote = await runWith(run, args, { env, fetch: server(200, other).fetch });
    const without = await runWith(run, args, { env, fetch: server(200, same).fetch });

    // The outcome is the same: only the output says it.
    expect(withNote.code).toBe(0);
    expect(withNote.out).toMatch(
      /\n\nNote: staging runs api 1\.2\.0 since 2026-10-01T07:00:00\.000Z, not 1\.1\.0\.\n$/,
    );
    expect(without.out).not.toContain("Note:");
  });

  it("notes when the deployed version went around the gate", async () => {
    const deployment = {
      id: "7a7a7a7a-8a1b-4c3d-9e0f-123456789abc",
      component: "api",
      environment: "staging",
      version: "1.1.0",
      commit: null,
      branch: null,
      tag: null,
      pullRequest: null,
      digest: null,
      tool: "argocd",
      sentBy: null,
      createdAt: "2026-10-01T07:00:00.000Z",
      deployedAt: "2026-10-01T07:00:00.000Z",
    };
    const gate = { from: "dev", verdictId: null, passedAt: null };
    const ungated = verdict({ deployed: { ...deployment, gate: { ...gate, gated: false } } });
    const gated = verdict({
      deployed: {
        ...deployment,
        gate: {
          ...gate,
          gated: true,
          verdictId: "0d0d0d0d-8a1b-4c3d-9e0f-123456789abc",
          passedAt: "2026-10-01T06:50:00.000Z",
        },
      },
    });

    const withNote = await runWith(run, args, { env, fetch: server(200, ungated).fetch });
    const without = await runWith(run, args, { env, fetch: server(200, gated).fetch });

    expect(withNote.code).toBe(0);
    expect(withNote.out).toMatch(
      /\n\nNote: api 1\.1\.0 was deployed to staging at 2026-10-01T07:00:00\.000Z without a pass in dev before it\.\n$/,
    );
    expect(without.out).not.toContain("Note:");
  });

  it("exits with 3 when there is no verdict", async () => {
    const forbidden = { error: { code: "forbidden", message: "Wrong scope." } };
    const cases = [
      await runWith(run, args, { env, fetch: server(403, forbidden).fetch }),
      await runWith(run, args, { env }),
      await runWith(run, args, { env: {} }),
      await runWith(run, ["verdict", "--component", "api"], { env }),
      await runWith(run, [...args, "--nope"], { env }),
    ];

    expect(cases.map((c) => c.code)).toEqual([3, 3, 3, 3, 3]);
    expect(cases.map((c) => c.out)).toEqual(["", "", "", "", ""]);
    expect(cases[0]?.err).toBe("Error: Wrong scope. (403 forbidden)\n");
    expect(cases[1]?.err).toBe(
      "Error: Can't reach Kollaudo at https://kollaudo.example.com: No network in tests\n",
    );
    expect(cases[2]?.err).toBe("Error: Set KOLLAUDO_URL to the URL of your Kollaudo server.\n");
    expect(cases[3]?.err).toMatch(/^Missing --env and --version\.\n\nUsage: kollaudo verdict/);
  });

  it("shows its help", async () => {
    expect(await runWith(run, ["verdict", "--help"])).toEqual({
      code: 0,
      out: VERDICT_HELP,
      err: "",
    });
  });
});
