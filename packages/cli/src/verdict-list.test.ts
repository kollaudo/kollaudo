import { describe, expect, it } from "vitest";
import { run } from "./run.ts";
import { runWith } from "./testing.ts";
import { VERDICT_LIST_HELP } from "./verdict-list.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_read" };
const given = {
  id: "0c0c0c0c-8a1b-4c3d-9e0f-123456789abc",
  component: "api",
  environment: "staging",
  version: "1.1.0",
  outcome: "fail",
  evidenceOutcome: "fail",
  message: "e2e failed.",
  policyRevision: 3,
  require: ["e2e"],
  overrideId: null,
  askedBy: "kargo",
  createdAt: "2026-10-02T09:10:00.000Z",
};

function server(status: number, body: unknown) {
  const requests: string[] = [];
  const fetch = async (url: string | URL | Request) => {
    requests.push(String(url));
    return new Response(JSON.stringify(body), { status });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

describe("kollaudo verdict list", () => {
  it("lists the verdicts given, with who asked, the policy and overrides", async () => {
    const overridden = {
      ...given,
      outcome: "pass",
      message: "Overridden by on-call until 2026-10-02T12:00:00.000Z: Hotfix",
      policyRevision: null,
      overrideId: "0b0b0b0b-8a1b-4c3d-9e0f-123456789abc",
      askedBy: null,
    };
    const { requests, fetch } = server(200, { items: [overridden, given], next: null });
    const result = await runWith(
      run,
      ["verdict", "list", "--component", "api", "--env", "staging", "--outcome", "fail"],
      { env, fetch },
    );

    expect(result).toEqual({
      code: 0,
      out:
        "2026-10-02T09:10:00.000Z  PASS (override)  api 1.1.0 in staging, asked by a deleted " +
        "token: Overridden by on-call until 2026-10-02T12:00:00.000Z: Hotfix\n" +
        "2026-10-02T09:10:00.000Z  FAIL  api 1.1.0 in staging, asked by kargo, policy revision 3: " +
        "e2e failed.\n",
      err: "",
    });
    expect(requests).toEqual([
      "https://kollaudo.example.com/v1/verdicts?component=api&environment=staging&outcome=fail",
    ]);
  });

  it("says when there are none", async () => {
    const { fetch } = server(200, { items: [], next: null });
    expect(await runWith(run, ["verdict", "list"], { env, fetch })).toEqual({
      code: 0,
      out: "No verdicts.\n",
      err: "",
    });
  });

  it("exits with 1 when the list can't be had", async () => {
    const { fetch } = server(403, {
      error: { code: "forbidden", message: "This endpoint needs a token with the read scope." },
    });
    const result = await runWith(run, ["verdict", "list"], { env, fetch });
    expect(result.code).toBe(1);
    expect(result.err).toContain("read scope");
  });

  it("shows its help", async () => {
    const result = await runWith(run, ["verdict", "list", "--help"], { env });
    expect(result).toEqual({ code: 0, out: VERDICT_LIST_HELP, err: "" });
  });
});
