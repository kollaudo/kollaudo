import { describe, expect, it } from "vitest";
import { BUG_HELP } from "./bug.ts";
import { run } from "./run.ts";
import { runWith, webPage } from "./testing.ts";

const env = { KOLLAUDO_URL: "https://kollaudo.example.com", KOLLAUDO_TOKEN: "kol_ingest" };
const readEnv = { ...env, KOLLAUDO_TOKEN: "kol_read" };

const given = {
  key: "SHOP-412",
  url: "https://example.atlassian.net/browse/SHOP-412",
  state: "open",
  component: "checkout",
  tests: ["checkout › pays with a saved card", "checkout › pays with a gift card"],
  by: "cart-ci",
  updatedAt: "2026-10-13T10:00:00.000Z",
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

describe("kollaudo bug", () => {
  it("links a bug to tests, open by default", async () => {
    const { requests, fetch } = server(200, given);
    const result = await runWith(
      run,
      [
        "bug",
        "link",
        "--component",
        "checkout",
        "--key",
        "SHOP-412",
        "--url",
        "https://example.atlassian.net/browse/SHOP-412",
        "--test",
        "checkout › pays with a saved card",
        "--test",
        "checkout › pays with a gift card",
      ],
      { env, fetch },
    );

    expect(result).toEqual({ code: 0, out: "Linked SHOP-412 in checkout: open\n", err: "" });
    const [{ url, init }] = requests as [(typeof requests)[number]];
    expect(url).toBe("https://kollaudo.example.com/v1/bugs");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ authorization: "Bearer kol_ingest" });
    expect(JSON.parse(init.body as string)).toEqual({
      component: "checkout",
      key: "SHOP-412",
      url: "https://example.atlassian.net/browse/SHOP-412",
      tests: ["checkout › pays with a saved card", "checkout › pays with a gift card"],
    });
  });

  it("requires component, key, url and at least one test to link", async () => {
    const result = await runWith(run, ["bug", "link", "--component", "checkout"], { env });
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^Missing --key, --url, --test\./);
  });

  it("closes every link of a bug in a component", async () => {
    const { requests, fetch } = server(200, { ...given, state: "closed", tests: [] });
    const result = await runWith(
      run,
      [
        "bug",
        "close",
        "--component",
        "checkout",
        "--key",
        "SHOP-412",
        "--url",
        "https://example.atlassian.net/browse/SHOP-412",
      ],
      { env, fetch },
    );

    expect(result).toEqual({ code: 0, out: "Closed SHOP-412 in checkout\n", err: "" });
    expect(requests[0]?.init.method).toBe("POST");
    expect(requests[0]?.init.headers).toMatchObject({ authorization: "Bearer kol_ingest" });
    expect(JSON.parse(requests[0]?.init.body as string)).toEqual({
      component: "checkout",
      key: "SHOP-412",
      url: "https://example.atlassian.net/browse/SHOP-412",
      state: "closed",
    });
  });

  it("needs an ingest token to link or close", async () => {
    const noToken = await runWith(
      run,
      [
        "bug",
        "link",
        "--component",
        "checkout",
        "--key",
        "SHOP-412",
        "--url",
        "https://example.atlassian.net/browse/SHOP-412",
        "--test",
        "checkout › pays with a saved card",
      ],
      { env: { KOLLAUDO_URL: env.KOLLAUDO_URL } },
    );
    expect(noToken).toEqual({
      code: 1,
      out: "",
      err: "Error: Set KOLLAUDO_TOKEN to an ingest token of your project.\n",
    });
  });

  it("lists bugs with a header and each test indented", async () => {
    const second = {
      ...given,
      key: "SHOP-500",
      component: "cart",
      state: "closed",
      tests: ["cart › adds an item"],
    };
    const { requests, fetch } = server(200, { items: [given, second] });
    const result = await runWith(run, ["bug", "list"], { env: readEnv, fetch });

    expect(result).toEqual({
      code: 0,
      out:
        "SHOP-412  open  checkout\n" +
        "  checkout › pays with a saved card\n" +
        "  checkout › pays with a gift card\n" +
        "SHOP-500  closed  cart\n" +
        "  cart › adds an item\n",
      err: "",
    });
    expect(requests[0]?.url).toBe("https://kollaudo.example.com/v1/bugs");
    expect(requests[0]?.init.method).toBe("GET");
    expect(requests[0]?.init.body).toBeUndefined();
    expect(requests[0]?.init.headers).toMatchObject({ authorization: "Bearer kol_read" });
  });

  it.each([
    [[], ""],
    [["--component", "checkout"], "?component=checkout"],
    [["--key", "SHOP-412"], "?key=SHOP-412"],
    [["--state", "open"], "?state=open"],
    [
      ["--component", "checkout", "--key", "SHOP-412", "--state", "open"],
      "?component=checkout&key=SHOP-412&state=open",
    ],
  ])("lists with optional filters: %j", async (filters, query) => {
    const { requests, fetch } = server(200, { items: [] });
    expect(
      await runWith(run, ["bug", "list", ...(filters as string[])], { env: readEnv, fetch }),
    ).toEqual({ code: 0, out: "No bugs.\n", err: "" });
    expect(requests[0]?.url).toBe(`https://kollaudo.example.com/v1/bugs${query}`);
  });

  it("prints the list API's answer unchanged with --json", async () => {
    const text = JSON.stringify({ items: [given], extra: "kept" });
    const requests: string[] = [];
    const fetch = async (url: string | URL | Request) => {
      requests.push(String(url));
      return new Response(text);
    };

    expect(
      await runWith(run, ["bug", "list", "--component", "checkout", "--json"], {
        env: readEnv,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).toEqual({ code: 0, out: `${text}\n`, err: "" });
    expect(requests).toEqual(["https://kollaudo.example.com/v1/bugs?component=checkout"]);
  });

  it("prints an empty answer as JSON too, not as prose", async () => {
    const body = { items: [] };
    const { fetch } = server(200, body);
    expect(await runWith(run, ["bug", "list", "--json"], { env: readEnv, fetch })).toEqual({
      code: 0,
      out: `${JSON.stringify(body)}\n`,
      err: "",
    });
  });

  it("needs a read or ingest token to list", async () => {
    const noToken = await runWith(run, ["bug", "list"], {
      env: { KOLLAUDO_URL: env.KOLLAUDO_URL },
    });
    expect(noToken).toEqual({
      code: 1,
      out: "",
      err: "Error: Set KOLLAUDO_TOKEN to a read or ingest token of your project.\n",
    });
  });

  it("explains a refused token and a server that answers with a page", async () => {
    const refused = server(403, {
      error: { code: "forbidden", message: "This endpoint needs a token with the read scope." },
    });
    expect(await runWith(run, ["bug", "list"], { env: readEnv, fetch: refused.fetch })).toEqual({
      code: 1,
      out: "",
      err: "Error: This endpoint needs a token with the read scope. (403 forbidden)\n",
    });

    const page = await runWith(run, ["bug", "list"], { env: readEnv, fetch: webPage });
    expect(page.code).toBe(1);
    expect(page.err).toContain("answered with a page, not with JSON");
  });

  it("explains when the server can't be reached", async () => {
    const unreachable = await runWith(run, ["bug", "list"], { env: readEnv });
    expect(unreachable).toEqual({
      code: 1,
      out: "",
      err: "Error: Can't reach Kollaudo at https://kollaudo.example.com: No network in tests\n",
    });
  });

  it("shows its help without calling the server", async () => {
    const { requests, fetch } = server(200, { items: [] });
    const help = await runWith(run, ["bug", "--help"], { fetch });
    expect(help).toEqual({ code: 0, out: BUG_HELP, err: "" });
    expect(requests).toEqual([]);

    const listHelp = await runWith(run, ["bug", "list", "--help"], { env: readEnv });
    expect(listHelp).toEqual({ code: 0, out: BUG_HELP, err: "" });
  });

  it("rejects unknown uses and unknown options", async () => {
    const unknown = await runWith(run, ["bug", "foo"], { env: readEnv });
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/^Unknown use of "kollaudo bug"\./);

    const { requests, fetch } = server(200, { items: [] });
    const invalid = await runWith(run, ["bug", "list", "--tool", "helm"], { env: readEnv, fetch });
    expect(invalid.code).toBe(1);
    expect(invalid.err).toContain("Unknown option '--tool'");
    expect(requests).toEqual([]);
  });

  it("registers the command in the main help", async () => {
    expect((await runWith(run, ["--help"])).out).toContain("bug ");
  });
});
