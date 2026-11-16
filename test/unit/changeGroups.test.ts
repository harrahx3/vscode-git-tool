import { describe, expect, it } from "vitest";
import {
  UNVERSIONED_TITLE,
  groupChanges,
  isIncluded,
  pruneChoices,
} from "../../src/shared/changeGroups";
import type { WorkingChange } from "../../src/shared/types";

const change = (path: string, index = " ", worktree = "M"): WorkingChange => ({
  path,
  index,
  worktree,
});

const CHANGES = [
  change("src/b.ts"),
  change("src/a.ts", "A", " "),
  change("README.md", "M", "M"),
  change("scratch.py", "?", "?"),
];
const LISTS = [
  { name: "Changes", active: true },
  { name: "Docs", active: false },
  { name: "Empty", active: false },
];

describe("groupChanges", () => {
  it("groups by changelist, sorts by path, keeps empty lists and adds unversioned last", () => {
    const groups = groupChanges(CHANGES, LISTS, { "README.md": "Docs" });
    expect(groups.map((g) => [g.name, g.items.map((c) => c.path)])).toEqual([
      ["Changes", ["src/a.ts", "src/b.ts"]],
      ["Docs", ["README.md"]],
      ["Empty", []],
      [UNVERSIONED_TITLE, ["scratch.py"]],
    ]);
    expect(groups.at(-1)?.unversioned).toBe(true);
  });

  it("omits the unversioned group when there are no untracked files", () => {
    const groups = groupChanges(CHANGES.slice(0, 3), LISTS, {});
    expect(groups.map((g) => g.name)).toEqual(["Changes", "Docs", "Empty"]);
  });
});

describe("isIncluded", () => {
  const groups = groupChanges(CHANGES, LISTS, { "README.md": "Docs" });
  const byPath = (p: string) => CHANGES.find((c) => c.path === p)!;

  it("ticks tracked files of the active changelist by default", () => {
    expect(isIncluded(byPath("src/b.ts"), {}, groups)).toBe(true);
    expect(isIncluded(byPath("README.md"), {}, groups)).toBe(false);
    expect(isIncluded(byPath("scratch.py"), {}, groups)).toBe(false);
  });

  it("follows explicit choices", () => {
    const choices = { "src/b.ts": false, "scratch.py": true };
    expect(isIncluded(byPath("src/b.ts"), choices, groups)).toBe(false);
    expect(isIncluded(byPath("scratch.py"), choices, groups)).toBe(true);
  });
});

describe("pruneChoices", () => {
  it("forgets files that are no longer changed", () => {
    const choices = { "src/b.ts": true, "gone.ts": false };
    expect(pruneChoices(choices, CHANGES)).toBe(true);
    expect(choices).toEqual({ "src/b.ts": true });
    expect(pruneChoices(choices, CHANGES)).toBe(false);
  });
});
