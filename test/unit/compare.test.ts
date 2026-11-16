// Branch comparison against a real temporary repository.
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareRefs } from "../../src/extension/git/queries";
import { Git } from "../../src/extension/git/runner";

let dir: string;
let git: Git;
const write = (f: string, text: string) => writeFileSync(join(dir, f), text);

async function commitAll(message: string) {
  await git.run(["add", "-A"]);
  await git.run(["commit", "-q", "-m", message]);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "git-tool-compare-"));
  git = new Git(dir, "git");
  await git.run(["init", "-q", "-b", "main"]);
  await git.run(["config", "user.name", "Test User"]);
  await git.run(["config", "user.email", "test@example.invalid"]);
  await git.run(["config", "commit.gpgsign", "false"]);
  write("a.txt", "one\n");
  write("b.txt", "bee\n");
  await commitAll("initial");
  // feature: modifies a.txt, adds c.txt, deletes b.txt (two commits).
  await git.run(["switch", "-q", "-c", "feature"]);
  write("a.txt", "one\ntwo\n");
  await commitAll("feature: a");
  write("c.txt", "sea\n");
  unlinkSync(join(dir, "b.txt"));
  await commitAll("feature: c, no b");
  // main: one commit of its own.
  await git.run(["switch", "-q", "main"]);
  write("d.txt", "dee\n");
  await commitAll("main: d");
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("compareRefs", () => {
  it("lists the commits of each side and the files that differ between the tips", async () => {
    const r = await compareRefs(git, "main", "feature");
    expect(r.onlyLeft.map((c) => c.subject)).toEqual(["main: d"]);
    expect(r.onlyRight.map((c) => c.subject)).toEqual(["feature: c, no b", "feature: a"]);
    expect(r.truncated).toBe(false);
    const files = Object.fromEntries(r.files.map((f) => [f.path, f.status]));
    // From main's tip to feature's tip.
    expect(files).toEqual({ "a.txt": "M", "b.txt": "D", "c.txt": "A", "d.txt": "D" });
  });

  it("is empty for identical refs and swaps cleanly", async () => {
    const same = await compareRefs(git, "main", "main");
    expect([same.onlyLeft, same.onlyRight, same.files]).toEqual([[], [], []]);
    const swapped = await compareRefs(git, "feature", "main");
    expect(swapped.onlyLeft).toHaveLength(2);
    expect(swapped.onlyRight).toHaveLength(1);
    expect(swapped.files.find((f) => f.path === "c.txt")?.status).toBe("D");
  });

  it("caps long histories", async () => {
    const r = await compareRefs(git, "main", "feature", 1);
    expect(r.onlyRight).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("rejects an unknown ref", async () => {
    await expect(compareRefs(git, "main", "nope")).rejects.toThrow();
  });
});
