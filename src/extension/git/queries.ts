// Read-only git queries used by the views.
import {
  LOG_FORMAT,
  REF_FORMAT,
  parseBlame,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseStatus,
} from "../../shared/parse";
import type {
  BlameLine,
  ChangedFile,
  Commit,
  CommitDetails,
  HeadInfo,
  LogFilter,
  Ref,
  WorkingChange,
} from "../../shared/types";
import type { Git } from "./runner";

export async function head(git: Git): Promise<HeadInfo> {
  const branch = (
    await git.run(["symbolic-ref", "-q", "--short", "HEAD"], { okCodes: [1] })
  ).trim();
  const hash = (await git.run(["rev-parse", "-q", "--verify", "HEAD"], { okCodes: [1] })).trim();
  return { branch: branch || undefined, hash: hash || undefined };
}

export async function refs(git: Git): Promise<Ref[]> {
  const out = await git.run([
    "for-each-ref",
    `--format=${REF_FORMAT}`,
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  return parseRefs(out);
}

/** Whether the filter keeps parent links meaningful (graph can be drawn). */
export function filterKeepsGraph(filter: LogFilter): boolean {
  return !filter.text && !filter.author && !filter.hashes;
}

export async function log(
  git: Git,
  filter: LogFilter,
  limit: number,
): Promise<{ commits: Commit[]; hasMore: boolean }> {
  if (filter.hashes) {
    if (!filter.hashes.length) return { commits: [], hasMore: false };
    const out = await git.run([
      "show",
      "-s",
      `--format=${LOG_FORMAT}`,
      ...filter.hashes.slice(0, limit),
    ]);
    return { commits: parseLog(out), hasMore: filter.hashes.length > limit };
  }
  const args = ["log", `--format=${LOG_FORMAT}`, "--date-order", `--max-count=${limit + 1}`];
  if (filter.text) args.push(`--grep=${filter.text}`, "--fixed-strings", "--regexp-ignore-case");
  if (filter.author) args.push(`--author=${filter.author}`, "--regexp-ignore-case");
  // Rewritten parents keep the graph connected through history simplification.
  if (filter.path) args.push("--parents");
  if (filter.branch) args.push(filter.branch);
  else args.push("--branches", "--remotes", "--tags", "HEAD");
  args.push("--");
  if (filter.path) args.push(filter.path);
  let commits: Commit[];
  try {
    commits = parseLog(await git.run(args));
  } catch (e) {
    // An empty repository has no HEAD yet.
    if (
      /does not have any commits|bad default revision|bad revision|unknown revision/.test(String(e))
    )
      return { commits: [], hasMore: false };
    throw e;
  }
  const hasMore = commits.length > limit;
  if (hasMore) commits.length = limit;
  // A text that looks like a hash also finds that commit.
  if (filter.text && /^[0-9a-f]{4,64}$/i.test(filter.text) && !filter.author) {
    const found = await git.run(
      ["show", "-s", `--format=${LOG_FORMAT}`, `${filter.text}^{commit}`],
      {
        okCodes: [128],
      },
    );
    for (const c of parseLog(found))
      if (!commits.some((x) => x.hash === c.hash)) commits.unshift(c);
  }
  return { commits, hasMore };
}

const DETAILS_FORMAT = ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ct", "%D", "%B"].join("%x1f");

export async function details(git: Git, hash: string): Promise<CommitDetails> {
  const out = await git.run(["show", "-s", `--format=${DETAILS_FORMAT}`, hash]);
  const [full, parents, author, email, at, committer, ct, decorations, ...message] =
    out.split("\x1f");
  const parentList = parents ? parents.split(" ").filter(Boolean) : [];
  const diffArgs = parentList.length
    ? ["diff-tree", "-r", "-z", "--name-status", "-M", parentList[0], full]
    : ["diff-tree", "-r", "-z", "--name-status", "--root", full];
  const files = parseNameStatus(await git.run(diffArgs));
  const body = message.join("\x1f").replace(/\n+$/, "");
  return {
    hash: full,
    parents: parentList,
    author,
    email,
    authorTime: Number(at),
    committer,
    committerTime: Number(ct),
    subject: body.split("\n", 1)[0],
    message: body,
    files,
    refs: decorations
      ? decorations
          .split(", ")
          .map((d) => d.replace(/^HEAD -> /, "").replace(/^tag: /, ""))
          .filter((d) => d && d !== "HEAD")
      : [],
  };
}

export async function status(git: Git): Promise<WorkingChange[]> {
  return parseStatus(await git.run(["status", "--porcelain=v1", "-z", "-uall"]));
}

/** Blame of a file; `contents` blames the editor's unsaved text instead of the file on disk. */
export async function blame(git: Git, path: string, contents?: string): Promise<BlameLine[]> {
  const args = ["blame", "--porcelain"];
  if (contents !== undefined) args.push("--contents", "-");
  args.push("--", path);
  return parseBlame(await git.run(args, { input: contents }));
}

/** Commits that touched lines `start..end` (1-based) of a file, newest first. */
export async function lineHistory(
  git: Git,
  path: string,
  start: number,
  end: number,
): Promise<string[]> {
  const out = await git.run(["log", "--format=%x1e%H", `-L${start},${end}:${path}`]);
  const hashes: string[] = [];
  for (const record of out.split("\x1e")) {
    const hash = record.slice(0, 40);
    if (/^[0-9a-f]{40}$/.test(hash)) hashes.push(hash);
  }
  return hashes;
}

/** Content of a file at a revision; empty when the file does not exist there. */
export async function showFile(git: Git, ref: string, path: string): Promise<string> {
  try {
    return await git.run(["show", `${ref}:${path}`]);
  } catch {
    return "";
  }
}

export async function lastMessage(git: Git): Promise<string | undefined> {
  const out = await git.run(["log", "-1", "--format=%B"], { okCodes: [128] });
  return out.replace(/\n+$/, "") || undefined;
}

export interface Comparison {
  /** Commits reachable from `left` but not from `right`, newest first. */
  onlyLeft: Commit[];
  /** Commits reachable from `right` but not from `left`, newest first. */
  onlyRight: Commit[];
  /** Files that differ from the tip of `left` to the tip of `right`. */
  files: ChangedFile[];
  /** True when a commit list was cut at `limit`. */
  truncated: boolean;
}

/** PyCharm's branch comparison: commits on each side, and the files that differ. */
export async function compareRefs(
  git: Git,
  left: string,
  right: string,
  limit = 1000,
): Promise<Comparison> {
  const [l, r] = await Promise.all(
    [left, right].map(async (ref) =>
      (await git.run(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim(),
    ),
  );
  const side = async (from: string, to: string) =>
    parseLog(
      await git.run([
        "log",
        `--format=${LOG_FORMAT}`,
        `--max-count=${limit + 1}`,
        `${to}..${from}`,
      ]),
    );
  const [onlyLeft, onlyRight, diff] = await Promise.all([
    side(l, r),
    side(r, l),
    git.run(["diff-tree", "-r", "-z", "--name-status", "-M", l, r]),
  ]);
  const truncated = onlyLeft.length > limit || onlyRight.length > limit;
  return {
    onlyLeft: onlyLeft.slice(0, limit),
    onlyRight: onlyRight.slice(0, limit),
    files: parseNameStatus(diff),
    truncated,
  };
}
