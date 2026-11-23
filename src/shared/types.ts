// Data shapes shared by the extension host and the webviews.

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Author date, Unix seconds. */
  authorTime: number;
  subject: string;
}

export type RefKind = "head" | "remote" | "tag";

export interface Ref {
  /** Short name: `main`, `origin/main`, `v1.0`. */
  name: string;
  kind: RefKind;
  /** Commit the ref points to (peeled for annotated tags). */
  hash: string;
  /** Upstream of a local branch, e.g. `origin/main`. */
  upstream?: string;
  /** Ahead/behind counts of a local branch against its upstream. */
  ahead?: number;
  behind?: number;
  /** Tags only: false when the tag is known to exist only locally (not on the remote). */
  pushed?: boolean;
}

export interface HeadInfo {
  /** Current branch name; undefined when HEAD is detached. */
  branch?: string;
  hash?: string;
}

export type FileStatus = "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?";

export interface ChangedFile {
  status: FileStatus;
  /** Path relative to the repository root, forward slashes. */
  path: string;
  /** Previous path of a rename or copy. */
  oldPath?: string;
}

export interface CommitDetails extends Commit {
  committer: string;
  committerTime: number;
  /** Full message (subject + body). */
  message: string;
  /** Changes against the first parent (the whole tree for a root commit). */
  files: ChangedFile[];
  /** Branches and tags containing the commit are not computed (costly); refs on it are. */
  refs: string[];
}

export interface LogFilter {
  /** Ref to show the history of; undefined = all branches, remotes and tags. */
  branch?: string;
  /** Matches the commit message (case-insensitive, literal) or a hash prefix. */
  text?: string;
  /** Matches the author name or email (case-insensitive). */
  author?: string;
  /** Path relative to the repository root. */
  path?: string;
  /** Explicit list of commits (history of a selection); other filters are ignored. */
  hashes?: string[];
  /** Human-readable label for an explicit list, e.g. `src/a.ts:10-20`. */
  label?: string;
}

/** Working-tree change as shown in the Commit view. */
export interface WorkingChange {
  path: string;
  oldPath?: string;
  /** Index (staged) status letter, `?` for untracked, ` ` for none. */
  index: string;
  /** Working-tree status letter, ` ` for none. */
  worktree: string;
}

export interface BlameLine {
  hash: string;
  author: string;
  authorTime: number;
  summary: string;
  /** True for lines not committed yet. */
  uncommitted: boolean;
}
