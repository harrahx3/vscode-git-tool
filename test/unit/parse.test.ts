import { describe, expect, it } from "vitest";
import {
  FIELD,
  RECORD,
  changeKind,
  parseBlame,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseStatus,
} from "../../src/shared/parse";

const H1 = "a".repeat(40);
const H2 = "b".repeat(40);
const H3 = "c".repeat(40);

describe("parseLog", () => {
  it("reads records, parents and ignores patch text after a record", () => {
    const out =
      `${RECORD}${H1}${FIELD}${H2} ${H3}${FIELD}Ann${FIELD}ann@x${FIELD}1700000000${FIELD}Merge it\n` +
      `${RECORD}${H2}${FIELD}${FIELD}Bob${FIELD}bob@x${FIELD}1600000000${FIELD}first: a${FIELD}b\n` +
      "diff --git a/x b/x\n@@ -1 +1 @@\n";
    const commits = parseLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: H1,
      parents: [H2, H3],
      author: "Ann",
      email: "ann@x",
      authorTime: 1700000000,
      subject: "Merge it",
    });
    expect(commits[1].parents).toEqual([]);
  });
});

describe("parseRefs", () => {
  it("classifies refs, peels tags, reads tracking and skips remote HEAD", () => {
    const line = (...f: string[]) => f.join(FIELD);
    const out = [
      line("refs/heads/main", H1, "", "origin/main", "ahead 2, behind 1"),
      line("refs/heads/feat/x", H2, "", "", ""),
      line("refs/remotes/origin/HEAD", H1, "", "", ""),
      line("refs/remotes/origin/main", H3, "", "", ""),
      line("refs/tags/v1", "d".repeat(40), H2, "", ""),
    ].join("\n");
    expect(parseRefs(out)).toEqual([
      { name: "main", kind: "head", hash: H1, upstream: "origin/main", ahead: 2, behind: 1 },
      { name: "feat/x", kind: "head", hash: H2 },
      { name: "origin/main", kind: "remote", hash: H3 },
      { name: "v1", kind: "tag", hash: H2 },
    ]);
  });
});

describe("parseNameStatus", () => {
  it("handles renames with similarity scores", () => {
    const out = ["M", "a.ts", "R087", "old.ts", "new.ts", "A", "dir/b.ts", ""].join("\0");
    expect(parseNameStatus(out)).toEqual([
      { status: "M", path: "a.ts" },
      { status: "R", path: "new.ts", oldPath: "old.ts" },
      { status: "A", path: "dir/b.ts" },
    ]);
  });
});

describe("parseStatus / changeKind", () => {
  it("reads porcelain v1 -z with renames and untracked files", () => {
    const out = [
      " M a.ts",
      "R  new.ts",
      "old.ts",
      "?? n.txt",
      "A  added.ts",
      " D gone.ts",
      "",
    ].join("\0");
    const changes = parseStatus(out);
    expect(changes).toEqual([
      { path: "a.ts", index: " ", worktree: "M" },
      { path: "new.ts", index: "R", worktree: " ", oldPath: "old.ts" },
      { path: "n.txt", index: "?", worktree: "?" },
      { path: "added.ts", index: "A", worktree: " " },
      { path: "gone.ts", index: " ", worktree: "D" },
    ]);
    expect(changes.map(changeKind)).toEqual(["M", "R", "?", "A", "D"]);
    expect(changeKind({ path: "c", index: "U", worktree: "U" })).toBe("U");
  });
});

describe("parseBlame", () => {
  it("repeats commit info for lines of an already-described commit", () => {
    const out = [
      `${H1} 1 1 2`,
      "author Ann",
      "author-time 1700000000",
      "summary First",
      "filename f",
      "\tline one",
      `${H1} 2 2`,
      "\tline two",
      `${"0".repeat(40)} 3 3 1`,
      "author Not Committed Yet",
      "author-time 1800000000",
      "summary Version of f from f",
      "filename f",
      "\tline three",
    ].join("\n");
    const lines = parseBlame(out);
    expect(lines.map((l) => [l.author, l.uncommitted])).toEqual([
      ["Ann", false],
      ["Ann", false],
      ["Not Committed Yet", true],
    ]);
    expect(lines[1].summary).toBe("First");
  });
});
