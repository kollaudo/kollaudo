import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HELP, run, VERSION } from "./run.ts";
import { runWith } from "./testing.ts";

const runCli = (args: string[]) => runWith(run, args);

describe("kollaudo", () => {
  it("prints help without arguments", async () => {
    expect(await runCli([])).toEqual({ code: 0, out: HELP, err: "" });
  });

  it("prints its version", async () => {
    expect(await runCli(["--version"])).toMatchObject({ code: 0, out: `${VERSION}\n` });
  });

  it("has the version of its package", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });

  it("fails on an unknown command", async () => {
    const { code, err } = await runCli(["deploy"]);

    expect(code).toBe(1);
    expect(err).toContain("Unknown command: deploy");
  });

  it("fails on an unknown option", async () => {
    expect((await runCli(["--nope"])).code).toBe(1);
  });
});
