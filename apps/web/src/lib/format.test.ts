import { describe, expect, it } from "vitest";
import { duration, shortVersion, timeAgo } from "./format.ts";

describe("timeAgo", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");

  it("describes recent and older times", () => {
    expect(timeAgo("2026-09-29T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-09-29T11:57:00Z", now)).toBe("3 minutes ago");
    expect(timeAgo("2026-09-29T09:00:00Z", now)).toBe("3 hours ago");
    expect(timeAgo("2026-09-28T12:00:00Z", now)).toBe("yesterday");
    expect(timeAgo("2026-09-01T12:00:00Z", now)).toBe("4 weeks ago");
  });
});

describe("duration", () => {
  it("picks a readable unit", () => {
    expect(duration(850)).toBe("850 ms");
    expect(duration(12_345)).toBe("12.3 s");
    expect(duration(245_000)).toBe("4 min 05 s");
  });
});

describe("shortVersion", () => {
  it("shortens full git SHAs only", () => {
    expect(shortVersion("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678")).toBe("a1b2c3d");
    expect(shortVersion("1.2.0")).toBe("1.2.0");
    expect(shortVersion("a1b2c3d")).toBe("a1b2c3d");
  });
});
