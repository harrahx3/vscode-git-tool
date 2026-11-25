// Git operations that change the repository. No VS Code dependency: tested against real
// repositories in test/unit/operations.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkingChange } from "../../shared/types";
import { incomingOverlap } from "./pullGuard";
import { GitError, type Git } from "./runner";
import { gitPathToLocal } from "../../shared/winPaths";

async function isMerging(git: Git): Promise<boolean> {
  const out = await git.run(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { okCodes: [1] });
  return out.trim().length > 0;
}

/**
 * Commits exactly the chosen files, whatever is staged (PyCharm semantics: the index is not the
 * selection). Untracked files are added first. During a merge everything chosen is staged and
 * the whole index is committed, since git refuses partial merge commits. Returns what the
 * hooks printed (git's stderr).
 */
export async function commitFiles(
  git: Git,
  changes: WorkingChange[],
  paths: string[],
  message: string,
  amend: boolean,
): Promise<string> {
  const chosen = changes.filter((c) => paths.includes(c.path));
  const untracked = chosen.filter((c) => c.index === "?").map((c) => c.path);
  const pathspec = chosen.flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path]));
  if (!pathspec.length && !amend) throw new Error("No files selected.");
  if (!message.trim()) throw new Error("The commit message is empty.");
  if (untracked.length) await git.write(["add", "--", ...untracked]);
  const args = ["commit", "--file=-", "--cleanup=strip"];
  if (amend) args.push("--amend");
  if (await isMerging(git)) {
    if (pathspec.length) await git.write(["add", "-A", "--", ...pathspec]);
  } else {
    args.push("--only");
    if (pathspec.length) args.push("--", ...pathspec);
  }
  return (await git.writeOutput(args, message)).stderr;
}

/** Current branch, or undefined when HEAD is detached. */
export async function currentBranch(git: Git): Promise<string | undefined> {
  const out = await git.run(["symbolic-ref", "-q", "--short", "HEAD"], { okCodes: [1] });
  return out.trim() || undefined;
}

/** Upstream of a branch from its configuration: remote and branch name on that remote. */
export async function upstreamOf(
  git: Git,
  branch: string,
): Promise<{ remote: string; branch: string } | undefined> {
  const get = async (key: string) =>
    (await git.run(["config", "--get", `branch.${branch}.${key}`], { okCodes: [1] })).trim();
  const [remote, merge] = await Promise.all([get("remote"), get("merge")]);
  if (!remote || !merge) return undefined;
  return { remote, branch: merge.replace(/^refs\/heads\//, "") };
}

/** The remote to push a new branch to: origin, else the first one. */
export async function defaultRemote(git: Git): Promise<string> {
  const remotes = (await git.run(["remote"])).split("\n").filter(Boolean);
  if (!remotes.length) throw new Error("The repository has no remote.");
  return remotes.includes("origin") ? "origin" : remotes[0];
}

/** Pushes the current branch, setting an upstream on the first push. */
export async function push(git: Git, force = false): Promise<void> {
  const branch = await currentBranch(git);
  if (!branch) throw new Error("HEAD is detached: you are not currently on a branch.");
  const upstream = await upstreamOf(git, branch);
  const forceArgs = force ? ["--force-with-lease"] : [];
  if (upstream && upstream.remote !== ".") {
    await git.network(["push", ...forceArgs, upstream.remote, `${branch}:${upstream.branch}`]);
    return;
  }
  const remote = await defaultRemote(git);
  await git.network(["push", ...forceArgs, "--set-upstream", remote, branch]);
}

/**
 * Pull (PyCharm's Update Project): fetches the upstream's remote, then merges or rebases onto the
 * upstream, stashing local changes around it. Problems are reported in git's words, so
 * errors.ts recognises them: no upstream, upstream deleted, conflicts.
 */
export async function update(
  git: Git,
  method: "merge" | "rebase",
  /** Asked, after the fetch, when local changes touch files the pull changes; false cancels. */
  confirmOverlap?: (files: string[]) => Promise<boolean>,
): Promise<void> {
  const branch = await currentBranch(git);
  if (!branch) throw new Error("HEAD is detached: you are not currently on a branch.");
  const upstream = await upstreamOf(git, branch);
  if (!upstream) throw new Error(`The current branch ${branch} has no upstream branch.`);
  if (upstream.remote !== ".") await git.network(["fetch", "--prune", upstream.remote]);
  const exists = await git.run(["rev-parse", "-q", "--verify", "@{upstream}"], {
    okCodes: [1, 128],
  });
  if (!exists.trim())
    throw new Error(
      `The upstream branch ${upstream.remote}/${upstream.branch} no longer exists on the remote.`,
    );
  if (confirmOverlap) {
    const files = await incomingOverlap(git);
    if (files.length && !(await confirmOverlap(files))) return;
  }
  await git.write(
    method === "rebase"
      ? ["rebase", "--autostash", "@{upstream}"]
      : ["merge", "--autostash", "--no-edit", "@{upstream}"],
  );
  // Re-applying the stashed local changes may conflict, while git still reports success.
  const conflicts = await conflictedFiles(git);
  if (conflicts.length)
    throw conflictError(
      git,
      "Applying autostash resulted in conflicts: your local changes are also kept in the stash.",
      conflicts,
    );
}

// ---- Unfinished operations and conflicts -----------------------------------------------------

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

export const OPERATION_LABEL: Record<Operation, string> = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-Pick",
  revert: "Revert",
};

/** The merge, rebase, cherry-pick or revert that stopped half-way, if any. */
export async function currentOperation(git: Git): Promise<Operation | undefined> {
  const dir = gitPathToLocal((await git.run(["rev-parse", "--absolute-git-dir"])).trim());
  const has = (name: string) => existsSync(join(dir, name));
  if (has("rebase-merge") || has("rebase-apply")) return "rebase";
  if (has("MERGE_HEAD")) return "merge";
  if (has("CHERRY_PICK_HEAD")) return "cherry-pick";
  if (has("REVERT_HEAD")) return "revert";
  return undefined;
}

/** Files git marks as unmerged (conflicted). */
export async function conflictedFiles(git: Git): Promise<string[]> {
  const out = await git.run(["diff", "--name-only", "--diff-filter=U", "-z"]);
  return [...new Set(out.split("\0").filter(Boolean))];
}

/**
 * How a file is conflicted, from the index stages git keeps for it: 1 = common ancestor,
 * 2 = ours (HEAD), 3 = theirs (the incoming side; the stash when re-applying one).
 * Only `both-modified` and `both-added` have conflict markers to resolve in an editor.
 */
export type ConflictKind =
  | "both-modified"
  | "both-added"
  | "deleted-by-us"
  | "deleted-by-them"
  | "added-by-us"
  | "added-by-them"
  | "both-deleted";

/** Classifies each conflicted file from the output of `git ls-files -u -z`. Pure. */
export function parseUnmerged(out: string): Map<string, ConflictKind> {
  const stages = new Map<string, Set<number>>();
  for (const entry of out.split("\0").filter(Boolean)) {
    const m = /^\d+ [0-9a-f]+ ([123])\t([\s\S]+)$/.exec(entry);
    if (!m) continue;
    const set = stages.get(m[2]) ?? new Set<number>();
    set.add(Number(m[1]));
    stages.set(m[2], set);
  }
  const kinds = new Map<string, ConflictKind>();
  for (const [file, s] of stages) {
    const [base, ours, theirs] = [s.has(1), s.has(2), s.has(3)];
    kinds.set(
      file,
      ours && theirs
        ? base
          ? "both-modified"
          : "both-added"
        : ours
          ? base
            ? "deleted-by-them"
            : "added-by-us"
          : theirs
            ? base
              ? "deleted-by-us"
              : "added-by-them"
            : "both-deleted",
    );
  }
  return kinds;
}

export async function conflictKinds(git: Git): Promise<Map<string, ConflictKind>> {
  return parseUnmerged(await git.run(["ls-files", "-u", "-z"]));
}

/** True when the file has two versions to merge, as opposed to one side having removed it. */
export const hasMarkers = (kind: ConflictKind | undefined) =>
  kind === undefined || kind === "both-modified" || kind === "both-added";

/** Which side still has the file, or undefined when both versions exist (or neither does). */
export function survivingSide(kind: ConflictKind): "ours" | "theirs" | undefined {
  if (kind === "deleted-by-them" || kind === "added-by-us") return "ours";
  if (kind === "deleted-by-us" || kind === "added-by-them") return "theirs";
  return undefined;
}

/** Resolves a conflicted file by keeping one side's version, or removing it when that side has none. */
export async function acceptSide(
  git: Git,
  file: string,
  side: "ours" | "theirs",
  kind?: ConflictKind,
): Promise<void> {
  const k = kind ?? (await conflictKinds(git)).get(file);
  const surviving = k && !hasMarkers(k) ? survivingSide(k) : side;
  if (k && !hasMarkers(k) && surviving !== side) {
    await git.write(["rm", "-q", "-f", "--", file]); // that side deleted the file
    return;
  }
  await git.write(["checkout", `--${side}`, "--", file]);
  await git.write(["add", "--", file]);
}

/** Resolves a file one side deleted: keep the surviving version or delete it. */
export async function resolveDeletion(
  git: Git,
  file: string,
  kind: ConflictKind,
  choice: "keep" | "delete",
): Promise<void> {
  const side = survivingSide(kind);
  if (choice === "keep" && side) return acceptSide(git, file, side, kind);
  await git.write(["rm", "-q", "-f", "--", file]);
}

/** Conflicted files whose content still has conflict markers. */
export async function filesWithMarkers(git: Git): Promise<string[]> {
  return (await conflictedFiles(git)).filter((f) => {
    try {
      const text = readFileSync(join(git.root, f), "utf8");
      return /^<{7}(?: |$)/m.test(text) && /^>{7}(?: |$)/m.test(text);
    } catch {
      return false; // deleted on one side: resolved by keeping or removing it
    }
  });
}

function conflictError(git: Git, message: string, files: string[]): GitError {
  const e = new GitError(message, `CONFLICT (content): ${message}\n${files.join("\n")}`, 1);
  e.git = git;
  return e;
}

/**
 * Continues after the conflicts are resolved: marks the conflicted files resolved (git add)
 * and commits (merge) or goes on with the remaining commits (rebase, cherry-pick, revert).
 */
export async function continueOperation(git: Git, op: Operation): Promise<void> {
  const marked = await filesWithMarkers(git);
  if (marked.length)
    throw conflictError(git, `Conflict markers remain in ${marked.join(", ")}.`, marked);
  const conflicted = await conflictedFiles(git);
  if (conflicted.length) await git.write(["add", "-A", "--", ...conflicted]);
  if (op === "merge") await git.write(["commit", "--no-edit"]);
  else await git.write([op, "--continue"]);
}

/** Conflicts outside any operation (a stash that did not re-apply cleanly): marks them resolved
 * and leaves the files as ordinary local changes. */
export async function markResolved(git: Git): Promise<void> {
  const marked = await filesWithMarkers(git);
  if (marked.length)
    throw conflictError(git, `Conflict markers remain in ${marked.join(", ")}.`, marked);
  const conflicted = await conflictedFiles(git);
  if (!conflicted.length) return;
  await git.write(["add", "-A", "--", ...conflicted]);
  await git.write(["reset", "-q", "--", ...conflicted]);
}

export async function abortOperation(git: Git, op: Operation): Promise<void> {
  await git.write([op, "--abort"]);
}

/** Skips the commit that stopped a rebase, cherry-pick or revert. */
export async function skipCommit(git: Git, op: Operation): Promise<void> {
  if (op === "merge") throw new Error("A merge has no commit to skip.");
  await git.write([op, "--skip"]);
}

// ---- Stash around an operation (PyCharm's "smart checkout") -----------------------------------

/** Stashes all local changes, untracked files included; false when there was nothing to stash. */
export async function stashChanges(git: Git, message: string): Promise<boolean> {
  const top = () => git.run(["rev-parse", "-q", "--verify", "refs/stash"], { okCodes: [1] });
  const before = (await top()).trim();
  await git.write(["stash", "push", "--include-untracked", "-m", message]);
  return (await top()).trim() !== before;
}

/** Re-applies the last stash; on conflicts git keeps it and the error says so. */
export async function unstashChanges(git: Git): Promise<void> {
  await git.write(["stash", "pop"]);
}

/** Rolls back tracked changes to HEAD. Added files are unstaged and kept on disk. */
export async function rollback(git: Git, changes: WorkingChange[]): Promise<void> {
  const added = changes.filter((c) => c.index === "A").map((c) => c.path);
  const others = changes
    .filter((c) => c.index !== "A" && c.index !== "?")
    .flatMap((c) => (c.oldPath ? [c.path, c.oldPath] : [c.path]));
  if (added.length) await git.write(["restore", "--staged", "--", ...added]);
  if (others.length)
    await git.write(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...others]);
}
