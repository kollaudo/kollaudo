import { readFileSync } from "node:fs";
import { CtrfReport, type CtrfTest } from "@kollaudo/schema";
import { describe, expect, it } from "vitest";
import { JunitError, junitToCtrf } from "./junit.ts";

// Real reports, written by each tool on small projects with passing, failing, skipped and flaky tests.
function convert(...names: string[]) {
  const files = names.map((name) => ({
    name,
    xml: readFileSync(new URL(`testdata/junit/${name}`, import.meta.url), "utf8"),
  }));
  const report = junitToCtrf(files, "junit");
  // What the CLI sends must be a report the server accepts.
  CtrfReport.parse(report);
  return report;
}

/** One line per test: status, suite, name, and retries or flaky when set. */
function lines(tests: CtrfTest[]) {
  return tests.map((t) =>
    [
      t.status,
      (t.suite as string[] | undefined)?.join(" › ") ?? "",
      t.name,
      t.retries ? `retries ${t.retries}` : "",
      t.flaky ? "flaky" : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

describe("junitToCtrf", () => {
  it("reads pytest: classes in the suite, errors as failures, decoded messages", () => {
    const { results } = convert("pytest.xml");

    expect(lines(results.tests)).toEqual([
      "passed | pytest › test_shop.TestCart | test_adds_a_product",
      "failed | pytest › test_shop.TestCart | test_total_includes_vat",
      "skipped | pytest › test_shop.TestCart | test_pays_with_a_card",
      "failed | pytest › test_shop | test_crashes_in_setup",
      "passed | pytest › test_shop | test_flaky_search",
    ]);
    expect(results.tests[1]).toMatchObject({
      message:
        "AssertionError: VAT is 22%\nassert 12.2 == 12.0\n +  where 12.2 = round((10 * 1.22), 2)",
      trace: expect.stringContaining("test_shop.py:8: AssertionError"),
    });
    expect(results.tests[2]?.message).toBe("payments sandbox is down");
    expect(results.tests[3]?.message).toBe(
      'failed on setup with "RuntimeError: database not reachable"',
    );
    // The timestamp has a time zone, so it gives the start of the run.
    expect(results.summary).toEqual({
      tests: 5,
      start: Date.parse("2026-10-01T12:55:16.318830+00:00"),
      stop: Date.parse("2026-10-01T12:55:16.318830+00:00") + 34,
    });
  });

  it("reads Maven Surefire: reruns of failed tests and flaky tests", () => {
    const { results } = convert("maven-surefire.xml");

    expect(lines(results.tests)).toEqual([
      "failed | shop.CheckoutTest | crashesOnNullCart | retries 2",
      "skipped | shop.CheckoutTest | handles3DSecure",
      "passed | shop.CheckoutTest | appliesADiscountCode",
      "failed | shop.CheckoutTest | paysWithACreditCard | retries 2",
      "passed | shop.CheckoutTest | retriesTheGatewayOnce | retries 1 | flaky",
    ]);
    // The suite says tests="2": counts come from the test cases.
    expect(results.summary.tests).toBe(5);
    expect(results.tests[3]?.message).toBe(
      "payment status ==> expected: <PAID> but was: <DECLINED>",
    );
    // No timestamp: Kollaudo will use the time it received the run.
    expect(results.summary.start).toBeUndefined();
  });

  it("reads Gradle with test-retry: one test per name, with its attempts", () => {
    const { results } = convert("gradle.xml");

    expect(lines(results.tests)).toEqual([
      "failed | shop.SearchTest | handlesAccents() | retries 2",
      "passed | shop.SearchTest | findsByName()",
      "passed | shop.SearchTest | ranksBestSellersFirst() | retries 1 | flaky",
    ]);
    // The duration of a test is the time of all its attempts.
    expect(results.tests[0]?.duration).toBe(26 * 3);
  });

  it("reads Jest (jest-junit): files, and messages from the first line of the text", () => {
    const { results } = convert("jest.xml");

    expect(lines(results.tests)).toEqual([
      "passed | cart | adds a product",
      "failed | cart | removes a product",
      "skipped | cart | keeps the cart after sign in",
      "passed | cart › cart totals | includes VAT",
    ]);
    expect(results.tests[1]).toMatchObject({
      filePath: "cart.test.js",
      message: "Error: expect(received).toEqual(expected) // deep equality",
    });
    // The timestamp has no time zone, so it's left out.
    expect(results.summary.start).toBeUndefined();
  });

  it("reads Vitest", () => {
    const { results } = convert("vitest.xml");

    expect(lines(results.tests)).toEqual([
      "passed | cart.spec.mjs | cart > adds a product",
      "failed | cart.spec.mjs | cart > removes a product",
      "skipped | cart.spec.mjs | cart > keeps the cart after sign in",
      "passed | cart.spec.mjs | cart > totals > includes VAT",
    ]);
    expect(results.tests[1]?.message).toBe("expected [ 1 ] to deeply equal [ 2 ]");
    expect(results.tests[1]?.duration).toBe(12);
  });

  it("reads go-junit-report: the reason is in the text, not in the message", () => {
    const { results } = convert("go-junit-report.xml");

    expect(lines(results.tests)).toEqual([
      "passed | example.com/shop | TestCreatesAnOrder",
      "failed | example.com/shop | TestRejectsAnEmptyCart",
      "passed | example.com/shop | TestShipping",
      "passed | example.com/shop | TestShipping/express",
      "skipped | example.com/shop | TestShipping/pickup",
    ]);
    expect(results.tests[1]?.message).toBe("orders_test.go:8: expected status 400, got 201");
    expect(results.tests[4]?.message).toBe("orders_test.go:13: no pickup points in the test data");
  });

  it("merges several files into one report", () => {
    const { results } = convert("pytest.xml", "go-junit-report.xml");

    expect(results.tool.name).toBe("junit");
    expect(results.summary.tests).toBe(10);
    // The run starts with the earliest suite and ends with the latest.
    expect(results.summary.start).toBe(Date.parse("2026-10-01T12:55:16.318830+00:00"));
    expect(results.summary.stop).toBe(Date.parse("2026-10-01T12:57:58Z") + 2);
  });

  it("reads test cases straight under <testsuites>, and properties and output", () => {
    const { results } = junitToCtrf(
      [
        {
          name: "custom.xml",
          xml: `<testsuites>
            <testcase name="boots" time="1,234.5">
              <properties><property name="owner" value="payments"/></properties>
              <system-out><![CDATA[listening on :8080]]></system-out>
            </testcase>
          </testsuites>`,
        },
      ],
      "custom",
    );

    expect(results.tool.name).toBe("custom");
    expect(results.tests).toEqual([
      {
        name: "boots",
        status: "passed",
        duration: 1_234_500,
        stdout: ["listening on :8080"],
        extra: { junit: { properties: { owner: "payments" } } },
      },
    ]);
  });

  it("refuses files that aren't JUnit", () => {
    expect(() => junitToCtrf([{ name: "broken.xml", xml: "<testsuite><testcase>" }], "j")).toThrow(
      JunitError,
    );
    expect(() => junitToCtrf([{ name: "pom.xml", xml: "<project/>" }], "j")).toThrow(
      "pom.xml isn't a JUnit report: it has no <testsuites> or <testsuite>.",
    );
  });
});
