// Conflicts that are not content conflicts, and the pull guard, on real temporary repositories.
import { mkdtempSync, rmSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptSide,
  conflictKinds,
  conflictedFiles,
  markResolved,
  parseUnmerged,
  resolveDeletion,
  update,
} from "../../src/extension/git/operations";
import {
  dropAutostash,
  hasAutostash,
  incomingOverlap,
  overlap,
  parseChangedPaths,
} from "../../src/extension/git/pullGuard";
import { status } from "../../src/extension/git/queries";
import { Git } from "../../src/extension/git/runner";

const entry = (stage: number, path: string) => `100644 ${"a".repeat(40)} ${stage}\t${path}\0`;

describe("parseUnmerged", () => {
  it("classifies conflicts from the index stages", () => {
    const out =
      entry(1, "a") +
      entry(2, "a") +
      entry(3, "a") + // both modified
      entry(2, "b") +
      entry(3, "b") + // both added
      entry(1, "c") +
      entry(2, "c") + // deleted by them
      entry(1, "d") +
      entry(3, "d") + // deleted by us
      entry(2, "e") + // added by us
      entry(3, "f") + // added by them
      entry(1, "g"); // both deleted
    expect([...parseUnmerged(out)]).toEqual([
      ["a", "both-modified"],
      ["b", "both-added"],
      ["c", "deleted-by-them"],
      ["d", "deleted-by-us"],
      ["e", "added-by-us"],
      ["f", "added-by-them"],
      ["g", "both-deleted"],
    ]);
  });
});

describe("pull guard (pure)", () => {
  it("reads both names of a rename", () => {
    const out = "M\0x.ts\0R086\0env.example\0.env.template\0D\0gone.txt\0";
    expect([...parseChangedPaths(out)]).toEqual([
      "x.ts",
      "env.example",
      ".env.template",
      "gone.txt",
    ]);
  });
  it("overlaps tracked local changes only", () => {
    const incoming = new Set(["a", "b"]);
    const local = [
      { path: "a", index: " ", worktree: "M" },
      { path: "c", oldPath: "b", index: "R", worktree: " " },
      { path: "b", index: "?", worktree: "?" },
      { path: "z", index: " ", worktree: "M" },
    ];
    expect(overlap(incoming, local)).toEqual(["a", "c"]);
  });
});

let dir: string;
let remote: string;
let git: Git;
const write = (f: string, text: string) => writeFileSync(join(dir, f), text);
const setup = async (g: Git) => {
  await g.run(["config", "user.name", "Test User"]);
  await g.run(["config", "user.email", "test@example.invalid"]);
  await g.run(["config", "commit.gpgsign", "false"]);
};
const commitAll = async (m: string) => {
  await git.run(["add", "-A"]);
  await git.run(["commit", "-q", "-m", m]);
};

/** `dir` is a clone of `remote`; another clone pushes a rename of env.example to .env.template. */
beforeEach(async () => {
  const base = mkdtempSync(join(tmpdir(), "git-tool-conflict-"));
  remote = join(base, "remote.git");
  dir = join(base, "work");
  const other = join(base, "other");
  await new Git(base, "git").run(["init", "-q", "--bare", "-b", "main", remote]);
  await new Git(base, "git").run(["clone", "-q", remote, dir]);
  git = new Git(dir, "git");
  await setup(git);
  write("env.example", "PORT=1\nHOST=a\nMODE=x\nDEBUG=0\n");
  write("keep.txt", "keep\n");
  await commitAll("initial");
  await git.run(["push", "-q", "-u", "origin", "main"]);
  await new Git(base, "git").run(["clone", "-q", remote, other]);
  const o = new Git(other, "git");
  await setup(o);
  await o.run(["mv", "env.example", ".env.template"]);
  await o.run(["commit", "-q", "-m", "rename template"]);
  await o.run(["push", "-q"]);
});
afterEach(() => rmSync(join(dir, ".."), { recursive: true, force: true }));

describe("a pull whose autostash conflicts on a rename", () => {
  const pullWithLocalDeletion = async () => {
    unlinkSync(join(dir, "env.example")); // uncommitted deletion of the file upstream renamed
    await update(git, "merge");
  };

  it("is flagged before pulling", async () => {
    unlinkSync(join(dir, "env.example"));
    await git.run(["fetch", "-q"]);
    expect(await incomingOverlap(git)).toEqual(["env.example"]);
  });

  it("asks for confirmation and stops when declined", async () => {
    unlinkSync(join(dir, "env.example"));
    const asked: string[][] = [];
    await update(git, "merge", async (files) => (asked.push(files), false));
    expect(asked).toEqual([["env.example"]]);
    expect(existsSync(join(dir, ".env.template"))).toBe(false); // nothing pulled
  });

  it("leaves a deleted-by-them conflict that one call resolves, then drops the autostash", async () => {
    await expect(pullWithLocalDeletion()).rejects.toThrow(/conflicts/);
    expect(await conflictedFiles(git)).toEqual([".env.template"]);
    const kinds = await conflictKinds(git);
    expect(kinds.get(".env.template")).toBe("deleted-by-them");

    await resolveDeletion(git, ".env.template", "deleted-by-them", "keep");
    await markResolved(git);
    expect(existsSync(join(dir, ".env.template"))).toBe(true);
    expect(await conflictedFiles(git)).toEqual([]);

    expect(await hasAutostash(git)).toBe(true);
    await dropAutostash(git);
    expect(await hasAutostash(git)).toBe(false);
    expect(await status(git)).toEqual([]);
  });

  it("accepting the side that deleted the file removes it", async () => {
    await expect(pullWithLocalDeletion()).rejects.toThrow();
    await acceptSide(git, ".env.template", "theirs"); // the stash side had no such file
    await markResolved(git);
    expect(existsSync(join(dir, ".env.template"))).toBe(false);
  });
});
