// Messages exchanged between the extension host and the two webviews.
import type { Commit, CommitDetails, FileStatus, HeadInfo, LogFilter, Ref } from "./types";

export interface RepoEntry {
  root: string;
  name: string;
}

// ---- Log view -------------------------------------------------------------------------------

export type LogToWebview =
  | { type: "repos"; repos: RepoEntry[]; current?: string }
  | { type: "refs"; head: HeadInfo; refs: Ref[] }
  | {
      type: "commits";
      /** Echo of the request id, so a slow answer to an outdated query is dropped. */
      requestId: number;
      commits: Commit[];
      /** False when the filter breaks the ancestry (text/author), the graph is then hidden. */
      graph: boolean;
      hasMore: boolean;
    }
  | { type: "details"; details: CommitDetails }
  | { type: "setFilter"; filter: LogFilter; select?: string }
  | { type: "select"; hash: string }
  | { type: "error"; message: string };

export type LogFromWebview =
  | { type: "ready" }
  | { type: "query"; requestId: number; filter: LogFilter; limit: number }
  | { type: "details"; hash: string }
  /** Selected commits, newest first: the multi-commit menu commands act on them. */
  | { type: "selection"; hashes: string[] }
  | { type: "openDiff"; hash: string; parent?: string; path: string; oldPath?: string }
  | { type: "selectRepo"; root: string }
  | { type: "refresh" }
  /** Runs one of the toolbar commands (see LOG_TOOLBAR_COMMANDS). */
  | { type: "command"; command: string };

/** Commands the Log toolbar may run through the host. */
export const LOG_TOOLBAR_COMMANDS = [
  "gitTool.newBranch",
  "gitTool.checkout",
  "gitTool.newTag",
  "gitTool.compareBranches",
  "gitTool.fetch",
  "gitTool.update",
  "gitTool.push",
  "gitTool.branches",
];

// ---- Commit view ----------------------------------------------------------------------------

export interface Changelist {
  name: string;
  active: boolean;
}

/** A changed file in the Commit view's list. */
export interface ChangeRow {
  path: string;
  oldPath?: string;
  /** Status letter: M, A, D, R, C, T, U (conflict) or ? (unversioned). */
  status: FileStatus;
  included: boolean;
  untracked: boolean;
  conflict: boolean;
}

/** A group of the list: a changelist, the unversioned files or the merge conflicts. */
export interface ChangeListView {
  /** Stable key, also used in the selection: `list:<name>`, `unversioned` or `conflicts`. */
  key: string;
  name: string;
  kind: "changelist" | "unversioned" | "conflicts";
  active: boolean;
  files: ChangeRow[];
}

/** What the Commit view shows: the message box state and the changed files below it. */
export interface CommitViewState {
  repoName?: string;
  branch?: string;
  /** Files ticked for the next commit, and all changed files. */
  included: number;
  total: number;
  /** Last commit message, offered when Amend is ticked. */
  lastMessage?: string;
  /** Unpushed commits on the current branch. */
  ahead?: number;
  lists: ChangeListView[];
  /** Shown above the list: no repository, no changes, an operation in progress… */
  notice?: string;
}

/** Commands the Commit view's rows may run through the host (clicks and inline buttons). */
export const COMMIT_ROW_COMMANDS = [
  "gitTool.change.diff",
  "gitTool.change.open",
  "gitTool.change.rollback",
  "gitTool.change.delete",
  "gitTool.change.resolve",
  "gitTool.operation.resolve",
] as const;
export type CommitRowCommand = (typeof COMMIT_ROW_COMMANDS)[number];

/** The `data-vscode-context` of a row, also the argument of the row's commands. */
export type RowContext =
  | {
      webviewSection: "change";
      path: string;
      /** Name of the row's group. */
      list: string;
      untracked: boolean;
      conflict: boolean;
    }
  | { webviewSection: "changelist"; list: string; active: boolean; empty: boolean }
  | { webviewSection: "unversioned" }
  | { webviewSection: "conflicts" };

export type CommitToWebview =
  | { type: "state"; state: CommitViewState }
  | { type: "busy"; busy: boolean; label?: string }
  | { type: "committed" }
  | { type: "error"; message: string };

export type CommitFromWebview =
  | { type: "ready" }
  | { type: "commit"; message: string; amend: boolean; push: boolean }
  /** Ticks or unticks files for the next commit. */
  | { type: "include"; paths: string[]; on: boolean }
  /** Selected rows (file `file:<path>` and group keys): menu commands act on them. */
  | { type: "selection"; keys: string[] }
  /** Files dropped on a changelist. */
  | { type: "move"; paths: string[]; list: string }
  | { type: "run"; command: CommitRowCommand; target: RowContext }
  /** What the list drew (for the integration tests): file paths and the notice. */
  | { type: "status"; files: string[]; notice?: string };
