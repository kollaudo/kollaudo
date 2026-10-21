import { describe, expect, it } from "vitest";
import { DEMO_HOST, isDemoHost } from "./demo.ts";

describe("isDemoHost", () => {
  it("is true only for the demo host", () => {
    expect(isDemoHost(DEMO_HOST)).toBe(true);
    expect(isDemoHost("localhost")).toBe(false);
    expect(isDemoHost("kollaudo.example.com")).toBe(false);
    expect(isDemoHost(`www.${DEMO_HOST}`)).toBe(false);
  });
});
