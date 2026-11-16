// Git worktrees: parsing `git worktree list --porcelain` and naming new worktrees. No VS Code
// dependency: unit-tested in test/unit/worktrees.test.ts.

export interface Worktree {
  /** Absolute path of the working tree, as git prints it. */
  path: string;
  /** Commit checked out; undefined in a bare repository or before the first commit. */
  head?: string;
  /** Short name of the branch checked out; undefined when HEAD is detached. */
  branch?: string;
  detached: boolean;
  bare: boolean;
  /** The main working tree (git lists it first); it cannot be removed. */
  main: boolean;
  /** Lock reason ("" when locked without one); undefined when not locked. */
  locked?: string;
  /** Why git would prune it (usually: its folder is gone); undefined when it is fine. */
  prunable?: string;
}

/** Parses `git worktree list --porcelain`: blank-line separated records of `key value` lines. */
export function parseWorktrees(out: string): Worktree[] {
  const list: Worktree[] = [];
  let current: Worktree | undefined;
  for (const raw of out.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) {
      current = undefined;
      continue;
    }
    const space = line.indexOf(" ");
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? "" : line.slice(space + 1);
    if (key === "worktree") {
      current = { path: value, detached: false, bare: false, main: list.length === 0 };
      list.push(current);
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "bare") current.bare = true;
    else if (key === "locked") current.locked = value;
    else if (key === "prunable") current.prunable = value;
  }
  return list;
}

/** Folder name for a branch: `feature/login` → `feature-login`. */
export function worktreeFolderName(branch: string): string {
  return (
    branch
      .replace(/^refs\/heads\//, "")
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/^-+|-+$/g, "") || "worktree"
  );
}

/**
 * Suggested path of a new worktree: `<repo>.worktrees/<branch>` next to the main working tree
 * (the layout VS Code's Git extension uses), with forward slashes like git prints them.
 */
export function defaultWorktreePath(mainPath: string, branch: string): string {
  const trimmed = mainPath.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const parent = cut < 0 ? "." : trimmed.slice(0, cut) || "/";
  const name = trimmed.slice(cut + 1);
  const sep = parent.endsWith("/") ? "" : "/";
  return `${parent}${sep}${name}.worktrees/${worktreeFolderName(branch)}`;
}

/** Path of the worktree a git message says the branch is checked out in, if any. */
export function checkedOutAt(message: string): string | undefined {
  return /is already (?:checked out|used by worktree) at '([^']+)'/.exec(message)?.[1];
}

/** Short text describing what a worktree has checked out. */
export function worktreeHeadLabel(w: Worktree): string {
  if (w.bare) return "bare";
  if (w.branch) return w.branch;
  return w.head ? `detached at ${w.head.slice(0, 8)}` : "no commits";
}
