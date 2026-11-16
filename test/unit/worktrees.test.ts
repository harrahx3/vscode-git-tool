import { describe, expect, it } from "vitest";
import {
  checkedOutAt,
  defaultWorktreePath,
  parseWorktrees,
  worktreeFolderName,
  worktreeHeadLabel,
} from "../../src/shared/worktrees";

// Output of `git worktree list --porcelain` (git 2.43).
const PORCELAIN = `worktree /w/repo
HEAD 801c56a6c3175346711160587b0fe0b5b5d34e05
branch refs/heads/main

worktree /w/repo.worktrees/feature-login
HEAD 1111111111111111111111111111111111111111
branch refs/heads/feature/login

worktree /w/detached
HEAD 2222222222222222222222222222222222222222
detached

worktree /w/usb
HEAD 801c56a6c3175346711160587b0fe0b5b5d34e05
branch refs/heads/f3
locked on usb

worktree /w/gone
HEAD 801c56a6c3175346711160587b0fe0b5b5d34e05
branch refs/heads/f4
locked
prunable gitdir file points to non-existent location

`;

describe("parseWorktrees", () => {
  const list = parseWorktrees(PORCELAIN);

  it("reads every record, the first one being the main working tree", () => {
    expect(list.map((w) => w.path)).toEqual([
      "/w/repo",
      "/w/repo.worktrees/feature-login",
      "/w/detached",
      "/w/usb",
      "/w/gone",
    ]);
    expect(list.map((w) => w.main)).toEqual([true, false, false, false, false]);
  });

  it("gives short branch names, detached heads, locks and missing folders", () => {
    expect(list[1].branch).toBe("feature/login");
    expect(list[2].detached).toBe(true);
    expect(list[2].branch).toBeUndefined();
    expect(list[3].locked).toBe("on usb");
    expect(list[4]).toMatchObject({
      locked: "",
      prunable: "gitdir file points to non-existent location",
    });
    expect(list[0].locked).toBeUndefined();
  });

  it("handles a bare main repository and CRLF output", () => {
    const bare = parseWorktrees(
      "worktree /w/bare.git\r\nbare\r\n\r\nworktree /w/a\r\nHEAD abc\r\n",
    );
    expect(bare[0]).toMatchObject({ path: "/w/bare.git", bare: true, main: true });
    expect(bare[1]).toMatchObject({ path: "/w/a", head: "abc", main: false });
  });

  it("labels what each worktree has checked out", () => {
    expect(list.map(worktreeHeadLabel)).toEqual([
      "main",
      "feature/login",
      "detached at 22222222",
      "f3",
      "f4",
    ]);
  });
});

describe("new worktree paths", () => {
  it("turns a branch into a folder name", () => {
    expect(worktreeFolderName("feature/login")).toBe("feature-login");
    expect(worktreeFolderName("refs/heads/a b:c")).toBe("a-b-c");
    expect(worktreeFolderName("///")).toBe("worktree");
  });

  it("suggests <repo>.worktrees/<branch> next to the main working tree", () => {
    expect(defaultWorktreePath("/home/u/proj/repo", "feature/x")).toBe(
      "/home/u/proj/repo.worktrees/feature-x",
    );
    expect(defaultWorktreePath("/home/u/proj/repo/", "main")).toBe(
      "/home/u/proj/repo.worktrees/main",
    );
    expect(defaultWorktreePath("/repo", "b")).toBe("/repo.worktrees/b");
    expect(defaultWorktreePath("C:\\src\\repo", "b")).toBe("C:\\src/repo.worktrees/b");
  });
});

describe("checkedOutAt", () => {
  it("finds the worktree a branch is checked out in", () => {
    expect(checkedOutAt("fatal: 'f1' is already used by worktree at '/w/w1'")).toBe("/w/w1");
    expect(checkedOutAt("fatal: 'feature' is already checked out at '/w/feature'")).toBe(
      "/w/feature",
    );
    expect(checkedOutAt("fatal: something else")).toBeUndefined();
  });
});
