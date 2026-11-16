// Pure logic of the Changes view: grouping changed files into changelists and the default
// "include in commit" ticks. No VS Code dependency (unit-tested).
import type { Changelist } from "./messages";
import type { WorkingChange } from "./types";

export interface ChangeGroup {
  /** Changelist name; "Unversioned Files" for the untracked group. */
  name: string;
  active: boolean;
  unversioned: boolean;
  /** The "Merge Conflicts" group: unmerged files, shown first. */
  conflicts?: boolean;
  /** Files of the group, sorted by path. */
  items: WorkingChange[];
}

export const UNVERSIONED_TITLE = "Unversioned Files";
export const CONFLICTS_TITLE = "Merge Conflicts";

export const isUntracked = (c: WorkingChange): boolean => c.index === "?";

/** Unmerged after a merge, rebase, cherry-pick, revert or unstash that stopped on conflicts. */
export const isConflicted = (c: WorkingChange): boolean =>
  c.index === "U" ||
  c.worktree === "U" ||
  (c.index === "A" && c.worktree === "A") ||
  (c.index === "D" && c.worktree === "D");

/**
 * The merge conflicts first when there are any, one group per changelist (kept even when empty,
 * like PyCharm), then the unversioned files when there are any. Paths missing from
 * `assignment` belong to the active changelist.
 */
export function groupChanges(
  changes: WorkingChange[],
  changelists: Changelist[],
  assignment: Record<string, string>,
): ChangeGroup[] {
  const active = changelists.find((c) => c.active)?.name ?? changelists[0]?.name;
  const byPath = (a: WorkingChange, b: WorkingChange) => a.path.localeCompare(b.path);
  const conflicted = changes.filter(isConflicted).sort(byPath);
  const groups: ChangeGroup[] = conflicted.length
    ? [
        {
          name: CONFLICTS_TITLE,
          active: false,
          unversioned: false,
          conflicts: true,
          items: conflicted,
        },
      ]
    : [];
  for (const cl of changelists)
    groups.push({
      name: cl.name,
      active: cl.active,
      unversioned: false,
      items: changes
        .filter(
          (c) => !isUntracked(c) && !isConflicted(c) && (assignment[c.path] ?? active) === cl.name,
        )
        .sort(byPath),
    });
  const untracked = changes.filter(isUntracked).sort(byPath);
  if (untracked.length)
    groups.push({ name: UNVERSIONED_TITLE, active: false, unversioned: true, items: untracked });
  return groups;
}

/**
 * Whether a file is included in the next commit: the user's explicit choice, else ticked when
 * it is tracked and in the active changelist (PyCharm default).
 */
export function isIncluded(
  change: WorkingChange,
  explicit: Record<string, boolean>,
  groups: ChangeGroup[],
): boolean {
  const choice = explicit[change.path];
  if (choice !== undefined) return choice;
  if (isUntracked(change) || isConflicted(change)) return false;
  return groups.some((g) => g.active && g.items.includes(change));
}

/** Drops explicit choices of files that are no longer changed; true when something changed. */
export function pruneChoices(explicit: Record<string, boolean>, changes: WorkingChange[]): boolean {
  const known = new Set(changes.map((c) => c.path));
  let pruned = false;
  for (const p of Object.keys(explicit))
    if (!known.has(p)) {
      delete explicit[p];
      pruned = true;
    }
  return pruned;
}
