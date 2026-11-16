// Commit, rollback and queries against real temporary repositories.
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitFiles, rollback } from "../../src/extension/git/operations";
import { blame, details, lineHistory, log, refs, status } from "../../src/extension/git/queries";
import { Git } from "../../src/extension/git/runner";

let dir: string;
let git: Git;
const write = (f: string, text: string) => writeFileSync(join(dir, f), text);
const read = (f: string) => readFileSync(join(dir, f), "utf8");

async function commitAll(message: string) {
  await git.run(["add", "-A"]);
  await git.run(["commit", "-q", "-m", message]);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "git-tool-"));
  git = new Git(dir, "git");
  await git.run(["init", "-q", "-b", "main"]);
  await git.run(["config", "user.name", "Test User"]);
  await git.run(["config", "user.email", "test@example.invalid"]);
  await git.run(["config", "commit.gpgsign", "false"]);
  write("a.txt", "one\ntwo\nthree\n");
  write("b.txt", "bee\n");
  await commitAll("initial");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("commitFiles", () => {
  it("commits only the ticked files, whatever is staged, and adds untracked ones", async () => {
    write("a.txt", "one\nTWO\nthree\n");
    write("b.txt", "BEE\n");
    write("new.txt", "fresh\n");
    await git.run(["add", "b.txt"]); // staged but not ticked
    const changes = await status(git);
    await commitFiles(git, changes, ["a.txt", "new.txt"], "pick two", false);
    const d = details(git, "HEAD");
    expect((await d).files.map((f) => f.path).sort()).toEqual(["a.txt", "new.txt"]);
    const after = await status(git);
    expect(after.map((c) => c.path)).toEqual(["b.txt"]);
    expect(after[0].index).toBe("M"); // still staged, untouched
  });

  it("commits deletions and renames", async () => {
    renameSync(join(dir, "a.txt"), join(dir, "renamed.txt"));
    await git.run(["add", "-A"]);
    unlinkSync(join(dir, "b.txt"));
    const changes = await status(git);
    await commitFiles(
      git,
      changes,
      changes.map((c) => c.path),
      "move and delete",
      false,
    );
    expect(await status(git)).toEqual([]);
    const files = (await details(git, "HEAD")).files;
    expect(files).toContainEqual({ status: "R", path: "renamed.txt", oldPath: "a.txt" });
    expect(files).toContainEqual({ status: "D", path: "b.txt" });
  });

  it("amends the message only when no file is ticked", async () => {
    write("b.txt", "changed\n");
    await commitFiles(git, await status(git), [], "initial, reworded", true);
    const { commits } = await log(git, {}, 10);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe("initial, reworded");
    expect((await status(git)).map((c) => c.path)).toEqual(["b.txt"]);
  });

  it("refuses an empty message or an empty selection", async () => {
    write("b.txt", "changed\n");
    const changes = await status(git);
    await expect(commitFiles(git, changes, ["b.txt"], "  ", false)).rejects.toThrow(/empty/);
    await expect(commitFiles(git, changes, [], "msg", false)).rejects.toThrow(/No files/);
  });
});

describe("rollback", () => {
  it("restores modified files and unstages added ones, keeping them on disk", async () => {
    write("a.txt", "dirty\n");
    write("added.txt", "x\n");
    await git.run(["add", "added.txt"]);
    await rollback(git, await status(git));
    expect(read("a.txt")).toBe("one\ntwo\nthree\n");
    expect(existsSync(join(dir, "added.txt"))).toBe(true);
    expect((await status(git)).map((c) => [c.path, c.index])).toEqual([["added.txt", "?"]]);
  });
});

describe("queries", () => {
  it("log filters by text, path and branch; refs and blame work", async () => {
    await git.run(["switch", "-q", "-c", "feature"]);
    write("b.txt", "bee 2\n");
    await commitAll("Fix the bee");
    await git.run(["switch", "-q", "main"]);
    write("a.txt", "one\ntwo\nthree\nfour\n");
    await commitAll("Add four");
    await git.run(["tag", "-a", "v1", "-m", "release"]);

    expect((await log(git, {}, 100)).commits).toHaveLength(3);
    expect((await log(git, { branch: "main" }, 100)).commits).toHaveLength(2);
    expect((await log(git, { text: "BEE" }, 100)).commits.map((c) => c.subject)).toEqual([
      "Fix the bee",
    ]);
    expect((await log(git, { path: "a.txt" }, 100)).commits.map((c) => c.subject)).toEqual([
      "Add four",
      "initial",
    ]);
    const limited = await log(git, {}, 2);
    expect(limited.commits).toHaveLength(2);
    expect(limited.hasMore).toBe(true);

    const r = await refs(git);
    const tag = r.find((x) => x.kind === "tag");
    const main = r.find((x) => x.name === "main");
    expect(tag?.hash).toBe(main?.hash); // annotated tag peeled to its commit

    const lines = await blame(git, "a.txt", "one\nchanged\nthree\nfour\n");
    expect(lines.map((l) => l.uncommitted)).toEqual([false, true, false, false]);
    expect(lines[3].summary).toBe("Add four");

    const hist = await lineHistory(git, "a.txt", 4, 4);
    expect(hist).toHaveLength(1);
  });

  it("an empty repository has no commits and no error", async () => {
    const empty = mkdtempSync(join(tmpdir(), "git-tool-empty-"));
    try {
      const g = new Git(empty, "git");
      await g.run(["init", "-q"]);
      expect(await log(g, {}, 10)).toEqual({ commits: [], hasMore: false });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
