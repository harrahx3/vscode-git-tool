import { describe, expect, it } from "vitest";
import { formatLogDate, groupByDirectory, splitPath } from "../../src/webview/common/format";

describe("formatLogDate", () => {
  const now = new Date(2026, 10, 9, 15, 0);
  const at = (d: Date) => d.getTime() / 1000;

  it("says Today / Yesterday, then the full date", () => {
    expect(formatLogDate(at(new Date(2026, 10, 9, 9, 5)), now)).toBe("Today 09:05");
    expect(formatLogDate(at(new Date(2026, 10, 8, 23, 59)), now)).toBe("Yesterday 23:59");
    expect(formatLogDate(at(new Date(2026, 9, 1, 8, 0)), now)).toBe("2026-10-01 08:00");
  });
});

describe("paths", () => {
  it("splits and groups by directory", () => {
    expect(splitPath("a/b/c.ts")).toEqual({ dir: "a/b", name: "c.ts" });
    expect(splitPath("c.ts")).toEqual({ dir: "", name: "c.ts" });
    const groups = groupByDirectory([{ path: "z/b.ts" }, { path: "r.md" }, { path: "z/a.ts" }]);
    expect(groups.map(([d, f]) => [d, f.map((x) => x.path)])).toEqual([
      ["", ["r.md"]],
      ["z", ["z/a.ts", "z/b.ts"]],
    ]);
  });
});
