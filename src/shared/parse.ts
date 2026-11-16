// Parsers for git plumbing output. Pure functions, tested in test/unit/parse.test.ts.
import type { BlameLine, ChangedFile, Commit, FileStatus, Ref, WorkingChange } from "./types";

export const FIELD = "\x1f";
export const RECORD = "\x1e";

/** `git log --format=` producing records parsed by {@link parseLog}. */
export const LOG_FORMAT = `${RECORD}%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s`;

/**
 * Parses `git log --format=LOG_FORMAT`. Anything after the first line of a record (patch text of
 * `git log -L`) is ignored.
 */
export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const record of out.split(RECORD)) {
    const line = record.split("\n", 1)[0];
    if (!line) continue;
    const [hash, parents, author, email, at, subject] = line.split(FIELD);
    if (!hash || !/^[0-9a-f]{7,64}$/.test(hash)) continue;
    commits.push({
      hash,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      author: author ?? "",
      email: email ?? "",
      authorTime: Number(at) || 0,
      subject: subject ?? "",
    });
  }
  return commits;
}

/** `git for-each-ref --format=` producing lines parsed by {@link parseRefs}. */
export const REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(*objectname)",
  "%(upstream:short)",
  "%(upstream:track,nobracket)",
].join("%1f");

/** Parses `git for-each-ref --format=REF_FORMAT refs/heads refs/remotes refs/tags`. */
export function parseRefs(out: string): Ref[] {
  const refs: Ref[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [full, object, peeled, upstream, track] = line.split(FIELD);
    const hash = peeled || object;
    let ref: Ref | undefined;
    if (full.startsWith("refs/heads/")) {
      ref = { name: full.slice(11), kind: "head", hash };
      if (upstream) ref.upstream = upstream;
      const ahead = /ahead (\d+)/.exec(track ?? "");
      const behind = /behind (\d+)/.exec(track ?? "");
      if (ahead) ref.ahead = Number(ahead[1]);
      if (behind) ref.behind = Number(behind[1]);
    } else if (full.startsWith("refs/remotes/")) {
      if (full.endsWith("/HEAD")) continue;
      ref = { name: full.slice(13), kind: "remote", hash };
    } else if (full.startsWith("refs/tags/")) {
      ref = { name: full.slice(10), kind: "tag", hash };
    }
    if (ref) refs.push(ref);
  }
  return refs;
}

const STATUSES = new Set(["M", "A", "D", "R", "C", "T", "U"]);

/** Parses `git diff-tree -r -z --name-status -M` output. */
export function parseNameStatus(out: string): ChangedFile[] {
  const parts = out.split("\0");
  const files: ChangedFile[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++];
    if (!code) continue;
    const letter = code[0];
    if (!STATUSES.has(letter)) continue;
    if (letter === "R" || letter === "C") {
      const oldPath = parts[i++];
      const path = parts[i++];
      files.push({ status: letter as FileStatus, path, oldPath });
    } else {
      files.push({ status: letter as FileStatus, path: parts[i++] });
    }
  }
  return files;
}

/** Parses `git status --porcelain=v1 -z -uall`. */
export function parseStatus(out: string): WorkingChange[] {
  const parts = out.split("\0");
  const changes: WorkingChange[] = [];
  let i = 0;
  while (i < parts.length) {
    const entry = parts[i++];
    if (!entry || entry.length < 4) continue;
    const index = entry[0];
    const worktree = entry[1];
    const path = entry.slice(3);
    if (index === "!") continue;
    const change: WorkingChange = { path, index, worktree };
    // In -z mode the original path of a rename/copy follows as its own field.
    if (index === "R" || index === "C" || worktree === "R" || worktree === "C") {
      change.oldPath = parts[i++];
    }
    changes.push(change);
  }
  return changes;
}

/** One status letter for a working change, the way the Commit view colours it. */
export function changeKind(change: WorkingChange): FileStatus {
  const { index, worktree } = change;
  if (index === "?") return "?";
  if (index === "U" || worktree === "U" || (index === "A" && worktree === "A")) return "U";
  if (index === "D" && worktree === "D") return "U";
  if (index === "R" || worktree === "R") return "R";
  if (index === "C") return "C";
  if (index === "A") return worktree === "D" ? "D" : "A";
  if (index === "D" || worktree === "D") return "D";
  return "M";
}

/** Parses `git blame --porcelain`; returns one entry per line of the file. */
export function parseBlame(out: string): BlameLine[] {
  const commits = new Map<string, BlameLine>();
  const lines: BlameLine[] = [];
  let current: BlameLine | undefined;
  for (const row of out.split("\n")) {
    if (row.startsWith("\t")) {
      if (current) lines.push(current);
      continue;
    }
    const header = /^([0-9a-f]{40,64}) \d+ \d+/.exec(row);
    if (header) {
      const hash = header[1];
      current = commits.get(hash);
      if (!current) {
        current = {
          hash,
          author: "",
          authorTime: 0,
          summary: "",
          uncommitted: /^0+$/.test(hash),
        };
        commits.set(hash, current);
      }
      continue;
    }
    if (!current) continue;
    if (row.startsWith("author ")) current.author = row.slice(7);
    else if (row.startsWith("author-time ")) current.authorTime = Number(row.slice(12));
    else if (row.startsWith("summary ")) current.summary = row.slice(8);
  }
  return lines;
}
