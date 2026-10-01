import { describe, expect, it } from "vitest";
import { PUSH_HELP } from "./push.ts";
import { run } from "./run.ts";
import { runWith } from "./testing.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com/", KOLLAUDO_TOKEN: "kol_ingest" };
const report = { results: { tool: { name: "playwright" }, summary: { tests: 1 }, tests: [] } };
const files = { "report.json": JSON.stringify(report), "broken.json": "{" };
const args = ["push", "report.json", "--component", "frontend", "--version", "1.2.0"];

const created = {
  id: "4f5c2d7e-8a1b-4c3d-9e0f-123456789abc",
  component: "frontend",
  version: "1.2.0",
  environment: "staging",
  kind: "e2e",
  summary: { tests: 42, passed: 39, failed: 1, skipped: 2, pending: 0, other: 0, flaky: 3 },
};

/** A fake server that records the request and answers with the given status and body. */
function server(status: number, body: unknown) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status });
  };
  return { requests, fetch: fetch as typeof globalThis.fetch };
}

describe("kollaudo push", () => {
  it("sends the report with its version and environment", async () => {
    const { requests, fetch } = server(201, created);
    const result = await runWith(
      run,
      [
        ...args,
        "--env",
        "staging",
        "--kind",
        "smoke",
        "--commit",
        "a1b2c3",
        "--pull-request",
        "42",
        "--digest",
        "sha256:4f5c",
      ],
      { env, files, fetch },
    );

    expect(result).toEqual({
      code: 0,
      out:
        "Sent 42 tests (e2e) for frontend 1.2.0 on staging: 39 passed, 1 failed, 2 skipped, 3 flaky\n" +
        `https://kollaudo.example.com/test-runs/${created.id}\n`,
      err: "",
    });
    expect(requests).toHaveLength(1);
    const [{ url, init }] = requests as [(typeof requests)[number]];
    expect(url).toBe("https://kollaudo.example.com/v1/test-runs");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer kol_ingest");
    expect(JSON.parse(init.body as string)).toEqual({
      component: "frontend",
      version: "1.2.0",
      environment: "staging",
      kind: "smoke",
      commit: "a1b2c3",
      pullRequest: "42",
      digest: "sha256:4f5c",
      report,
    });
  });

  it("leaves out the environment for build-level runs", async () => {
    const { requests, fetch } = server(201, { ...created, environment: null, kind: "unit" });
    const { code, out } = await runWith(run, [...args, "--kind", "unit"], { env, files, fetch });

    expect(code).toBe(0);
    expect(out).toMatch(/^Sent 42 tests \(unit\) for frontend 1\.2\.0: /);
    expect(JSON.parse(requests[0]?.init.body as string)).not.toHaveProperty("environment");
  });

  it("exits with 0 even if tests failed", async () => {
    const failing = { ...created, summary: { ...created.summary, passed: 0, failed: 42 } };
    const { code } = await runWith(run, args, { env, files, fetch: server(201, failing).fetch });
    expect(code).toBe(0);
  });

  it("lists the problems of an invalid report", async () => {
    const { fetch } = server(400, {
      error: {
        code: "invalid_request",
        message: "The request is not valid.",
        issues: [
          { path: "component", message: "Use up to 100 letters…" },
          { path: "report.results.tests.0.status", message: "Invalid option" },
        ],
      },
    });
    const result = await runWith(run, args, { env, files, fetch });

    expect(result).toEqual({
      code: 1,
      out: "",
      err:
        "Error: The request is not valid. (400 invalid_request)\n" +
        "  component: Use up to 100 letters…\n" +
        "  report.json: results.tests.0.status: Invalid option\n",
    });
  });

  it("explains a token without the ingest scope", async () => {
    const { fetch } = server(403, {
      error: { code: "forbidden", message: "This token doesn't have the ingest scope." },
    });
    const { code, err } = await runWith(run, args, { env, files, fetch });

    expect(code).toBe(1);
    expect(err).toBe("Error: This token doesn't have the ingest scope. (403 forbidden)\n");
  });

  it("explains an answer that doesn't come from Kollaudo", async () => {
    const { fetch } = server(502, "<html>Bad Gateway</html>");
    const { code, err } = await runWith(run, args, { env, files, fetch });

    expect(code).toBe(1);
    expect(err).toContain("Kollaudo answered 502");
  });

  it("explains an unreachable server", async () => {
    const fetch = () =>
      Promise.reject(new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") }));
    const { code, err } = await runWith(run, args, { env, files, fetch });

    expect(code).toBe(1);
    expect(err).toBe("Error: Can't reach Kollaudo at https://kollaudo.example.com: ECONNREFUSED\n");
  });

  it("fails on a missing or broken report without calling the server", async () => {
    const missing = await runWith(run, ["push", "nope.json", ...args.slice(2)], { env, files });
    const broken = await runWith(run, ["push", "broken.json", ...args.slice(2)], { env, files });

    expect(missing).toMatchObject({
      code: 1,
      err: expect.stringContaining("Can't read nope.json"),
    });
    expect(broken.err).toBe("Error: Can't read broken.json: it isn't valid JSON\n");
  });

  it("needs the server URL and token", async () => {
    const noUrl = await runWith(run, args, { env: { KOLLAUDO_TOKEN: "kol_ingest" }, files });
    const noToken = await runWith(run, args, { env: { KOLLAUDO_URL: "http://k" }, files });

    expect(noUrl.err).toContain("Set KOLLAUDO_URL");
    expect(noToken.err).toContain("Set KOLLAUDO_TOKEN");
  });

  it("needs a report, a component and a version", async () => {
    expect((await runWith(run, ["push", "--component", "a", "--version", "1"])).err).toContain(
      "Give at least one report file.",
    );
    expect((await runWith(run, ["push", "report.json"])).err).toContain(
      "Missing --component and --version.",
    );
  });

  describe("JUnit and several files", () => {
    const junit = (name: string, status = "") =>
      `<testsuite name="${name}"><testcase classname="${name}" name="works" time="0.5">${status}</testcase></testsuite>`;
    const reports = {
      "results/unit/a.xml": junit("a"),
      "results/unit/b.xml": junit("b", '<failure message="boom"/>'),
      "results/e2e.json": JSON.stringify(report),
      "shard-1.json": JSON.stringify({
        results: {
          tool: { name: "playwright" },
          summary: { tests: 1, start: 20 },
          tests: [{ name: "one", status: "passed", duration: 1 }],
        },
      }),
      "shard-2.json": JSON.stringify({
        results: {
          tool: { name: "playwright" },
          summary: { tests: 1, start: 10 },
          tests: [{ name: "two", status: "failed", duration: 2 }],
        },
      }),
    };
    const sent = (requests: { init: RequestInit }[]) =>
      JSON.parse(requests[0]?.init.body as string);
    const flags = ["--component", "api", "--version", "3f2a9c1", "--kind", "unit"];

    it("converts JUnit files matched by a pattern into one CTRF report", async () => {
      const { requests, fetch } = server(201, { ...created, kind: "unit", environment: null });
      const result = await runWith(
        run,
        ["push", "results/unit/*.xml", ...flags, "--tool", "maven"],
        {
          env,
          files: reports,
          fetch,
        },
      );

      expect(result.code).toBe(0);
      expect(result.out).toMatch(
        /^Sent 42 tests \(unit\) from 2 JUnit files for frontend 1\.2\.0: /,
      );
      const body = sent(requests);
      expect(body.report.results.tool).toEqual({ name: "maven" });
      expect(body.report.results.tests).toEqual([
        { name: "works", status: "passed", duration: 500, suite: ["a"] },
        { name: "works", status: "failed", duration: 500, suite: ["b"], message: "boom" },
      ]);
    });

    it("merges CTRF reports, such as the shards of a Playwright run", async () => {
      const { requests, fetch } = server(201, created);
      const result = await runWith(run, ["push", "shard-1.json", "shard-2.json", ...flags], {
        env,
        files: reports,
        fetch,
      });

      expect(result.out).toContain("from 2 CTRF files");
      expect(sent(requests).report.results).toMatchObject({
        tool: { name: "playwright" },
        summary: { tests: 2, start: 10 },
        tests: [{ name: "one" }, { name: "two" }],
      });
    });

    it("refuses to mix formats, and patterns that match nothing", async () => {
      const mixed = await runWith(run, ["push", "results/**/*", ...flags], { env, files: reports });
      const none = await runWith(run, ["push", "out/*.xml", ...flags], { env, files: reports });
      const notJunit = await runWith(run, ["push", "pom.xml", ...flags], {
        env,
        files: { "pom.xml": "<project/>" },
      });

      expect(mixed).toMatchObject({ code: 1, out: "" });
      expect(mixed.err).toBe(
        "Error: Send CTRF and JUnit files in separate pushes: they make separate runs.\n",
      );
      expect(none.err).toBe("Error: No file matches out/*.xml.\n");
      expect(notJunit.err).toBe(
        "Error: pom.xml isn't a JUnit report: it has no <testsuites> or <testsuite>.\n",
      );
    });
  });

  it("prints its help", async () => {
    expect(await runWith(run, ["push", "--help"])).toEqual({ code: 0, out: PUSH_HELP, err: "" });
  });
});
