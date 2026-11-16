import { describe, expect, it } from "vitest";
import { displayRef, treeTargets } from "../../src/shared/selection";

describe("treeTargets", () => {
  const [a, b, c] = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("acts on the whole selection when it holds the clicked node", () => {
    expect(treeTargets(b, [a, b])).toEqual([a, b]);
  });
  it("acts on the clicked node only when it is outside the selection", () => {
    expect(treeTargets(c, [a, b])).toEqual([c]);
  });
  it("falls back to the clicked node, or the selection from a keybinding", () => {
    expect(treeTargets(a, undefined)).toEqual([a]);
    expect(treeTargets(undefined, [a, b])).toEqual([a, b]);
  });
});

describe("displayRef", () => {
  it("shortens full hashes and keeps names", () => {
    expect(displayRef("0123456789abcdef0123456789abcdef01234567")).toBe("01234567");
    expect(displayRef("feature/x")).toBe("feature/x");
    expect(displayRef("HEAD~1")).toBe("HEAD~1");
  });
});
