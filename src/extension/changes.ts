// The changed files of the Commit view: changelists with their files, the "include in commit"
// ticks (PyCharm semantics), the selection made in the webview, and what menu commands act on.
// The Commit webview (commitView.ts) draws them under the message box.
import * as path from "path";
import * as vscode from "vscode";
import {
  fileKey,
  groupChanges,
  groupKey,
  isConflicted,
  isIncluded,
  isUntracked,
  pruneChoices,
  type ChangeGroup,
} from "../shared/changeGroups";
import type { ChangeListView, FileRef, RepoHeader, RowContext } from "../shared/messages";
import { changeKind } from "../shared/parse";
import type { WorkingChange } from "../shared/types";
import type { Changelists } from "./changelists";
import { OPERATION_LABEL, currentOperation, type Operation } from "./git/operations";
import { head, lastMessage, refs, status } from "./git/queries";
import type { Repos } from "./git/repos";
import { openWorkingDiff } from "./revisions";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Selection key of the row a menu or button was used on. */
function keyOf(ctx: RowContext, fallbackRoot: string | undefined): string {
  const root = ctx.root ?? fallbackRoot;
  switch (ctx.webviewSection) {
    case "change":
      return fileKey(root, ctx.path);
    case "changelist":
      return `${root ?? ""}|list:${ctx.list}`;
    default:
      return `${root ?? ""}|${ctx.webviewSection}`;
  }
}

function isRowContext(x: unknown): x is RowContext {
  const s = (x as { webviewSection?: unknown } | undefined)?.webviewSection;
  return s === "change" || s === "changelist" || s === "unversioned" || s === "conflicts";
}

/** Everything the Commit view knows about one repository. */
interface RepoState {
  root: string;
  branch?: string;
  ahead?: number;
  lastMessage?: string;
  /** The merge, rebase, cherry-pick or revert that stopped half-way. */
  operation?: Operation;
  /** Error of the last refresh, shown in the view. */
  error?: string;
  changes: WorkingChange[];
  groups: ChangeGroup[];
  /** Explicit checkbox choices, path → included. */
  choices: Record<string, boolean>;
}

/**
 * The changed files of the repositories the views list (one, or all in workspace scope "all").
 * Commands act on `root`, the current repository: a row's menu passes its repository (see `reg` in
 * extension.ts), so only the files of that row's repository are targeted.
 */
export class Changes implements vscode.Disposable {
  private states = new Map<string, RepoState>();
  /** Repositories listed, in order. */
  private shown: string[] = [];
  /** Rows selected in the webview (see changeGroups.ts for the keys). */
  private selection: string[] = [];
  private generation = 0;

  private readonly stateChanged = new vscode.EventEmitter<void>();
  /** Fires when the files, their ticks or the branch change. */
  readonly onDidChangeState = this.stateChanged.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly repos: Repos,
    readonly changelists: Changelists,
    private readonly memento: vscode.Memento,
  ) {
    this.disposables.push(
      this.stateChanged,
      repos.onDidChange(() => void this.refresh()),
    );
  }

  // ---- Data -----------------------------------------------------------------------------------

  private latest?: Promise<void>;

  /** Reloads the changes; resolves once the newest refresh (maybe a later one) is shown. */
  async refresh(): Promise<void> {
    let current = this.load();
    this.latest = current;
    await current;
    // A refresh started meanwhile superseded this one: wait for it, so callers see the result.
    while (this.latest !== current) {
      current = this.latest;
      await current;
    }
  }

  /** The repository commands act on: the current one (the first listed if it is not listed). */
  get root(): string | undefined {
    const root = this.repos.currentRoot();
    return root && this.states.has(root) ? root : this.shown[0];
  }

  private get cur(): RepoState | undefined {
    const root = this.root;
    return root ? this.states.get(root) : undefined;
  }

  get branch(): string | undefined {
    return this.cur?.branch;
  }
  get ahead(): number | undefined {
    return this.cur?.ahead;
  }
  get lastMessage(): string | undefined {
    return this.cur?.lastMessage;
  }
  get operation(): Operation | undefined {
    return this.cur?.operation;
  }
  get error(): string | undefined {
    return this.cur?.error;
  }

  private async load(): Promise<void> {
    const generation = ++this.generation;
    const shown = this.repos.scopedRoots();
    const states = new Map<string, RepoState>();
    await Promise.all(
      shown.map(async (root) => {
        const previous = this.states.get(root);
        states.set(root, await this.loadRepo(root, previous));
      }),
    );
    if (generation !== this.generation) return;
    if (shown.join("\n") !== this.shown.join("\n")) this.selection = [];
    this.shown = shown;
    this.states = states;
    for (const st of states.values())
      if (pruneChoices(st.choices, st.changes)) void this.saveChoices(st.root);
    this.update();
  }

  private async loadRepo(root: string, previous?: RepoState): Promise<RepoState> {
    const choices = previous?.choices ?? { ...this.memento.get(`checked:${root}`, {}) };
    const git = this.repos.git(root);
    try {
      const [changes, h, allRefs, last, operation] = await Promise.all([
        status(git),
        head(git),
        refs(git),
        lastMessage(git),
        currentOperation(git),
      ]);
      const lists = await this.changelists.snapshot(
        root,
        changes.map((c) => c.path),
      );
      const branch = allRefs.find((r) => r.kind === "head" && r.name === h.branch);
      return {
        root,
        changes,
        groups: groupChanges(changes, lists.changelists, lists.assignment),
        choices,
        branch: h.branch ?? (h.hash ? `detached at ${h.hash.slice(0, 8)}` : undefined),
        ahead: branch?.upstream ? (branch.ahead ?? 0) : undefined,
        lastMessage: last,
        operation,
      };
    } catch (e) {
      return {
        root,
        changes: [],
        groups: [],
        choices,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private update(): void {
    const known = new Set<string>();
    for (const st of this.states.values()) {
      for (const g of st.groups) known.add(groupKey(st.root, g));
      for (const c of st.changes) known.add(fileKey(st.root, c.path));
    }
    this.selection = this.selection.filter((k) => known.has(k));
    const op = this.cur?.operation;
    void vscode.commands.executeCommand("setContext", "gitTool.operation", op ?? "");
    void vscode.commands.executeCommand("setContext", "gitTool.conflicts", this.conflicts > 0);
    this.stateChanged.fire();
  }

  /** Several repositories are listed: rows are grouped under a header per repository. */
  get multi(): boolean {
    return this.shown.length > 1;
  }

  /** The groups and files as the webview draws them. */
  lists(): ChangeListView[] {
    return [...this.states.values()].flatMap((st) =>
      st.groups.map((g) => ({
        root: st.root,
        key: groupKey(st.root, g),
        name: g.name,
        kind: (g.conflicts ? "conflicts" : g.unversioned ? "unversioned" : "changelist") as
          "conflicts" | "unversioned" | "changelist",
        active: g.active,
        files: g.items.map((c) => ({
          path: c.path,
          oldPath: c.oldPath,
          status: changeKind(c),
          included: this.included(st, c),
          untracked: isUntracked(c),
          conflict: isConflicted(c),
        })),
      })),
    );
  }

  /** Headers of the repositories, when several are listed. */
  headers(): RepoHeader[] | undefined {
    if (!this.multi) return undefined;
    return [...this.states.values()].map((st) => ({
      root: st.root,
      name: path.basename(st.root),
      branch: st.branch,
      ahead: st.ahead,
      notice: repoNotice(st),
    }));
  }

  /** Line above the list: no repository, an operation or conflicts to finish, no changes. */
  notice(): string | undefined {
    const st = this.cur;
    if (!st) return "No Git repository is open.";
    if (this.multi) return undefined;
    return repoNotice(st) ?? (st.changes.length ? undefined : "No changes.");
  }

  // ---- Ticks ----------------------------------------------------------------------------------

  private included(st: RepoState, c: WorkingChange): boolean {
    return isIncluded(c, st.choices, st.groups);
  }

  /** Ticks or unticks files (the webview expands a group or a selection into its files). */
  async include(files: readonly FileRef[], on: boolean): Promise<void> {
    const byRoot = new Map<string, string[]>();
    for (const f of files) {
      const root = f.root ?? this.root;
      if (root) byRoot.set(root, [...(byRoot.get(root) ?? []), f.path]);
    }
    for (const [root, paths] of byRoot) {
      const st = this.states.get(root);
      if (!st) continue;
      const known = new Set(st.changes.filter((c) => !isConflicted(c)).map((c) => c.path));
      for (const p of paths) if (known.has(p)) st.choices[p] = on;
      await this.saveChoices(root);
    }
    this.stateChanged.fire();
  }

  private saveChoices(root: string): Thenable<void> {
    const st = this.states.get(root);
    return st ? this.memento.update(`checked:${root}`, st.choices) : Promise.resolve();
  }

  /** Paths ticked for the next commit in a repository (default: the current one). */
  includedPaths(root = this.root): string[] {
    const st = root ? this.states.get(root) : undefined;
    return st ? st.changes.filter((c) => this.included(st, c)).map((c) => c.path) : [];
  }

  /** Repositories with ticked files, and those files. */
  includedByRoot(): { root: string; paths: string[] }[] {
    return [...this.states.keys()]
      .map((root) => ({ root, paths: this.includedPaths(root) }))
      .filter((b) => b.paths.length);
  }

  /** Number of ticked files in all listed repositories. */
  get includedCount(): number {
    return this.includedByRoot().reduce((n, b) => n + b.paths.length, 0);
  }

  /** Changed files in all listed repositories. */
  get total(): number {
    return [...this.states.values()].reduce((n, st) => n + st.changes.length, 0);
  }

  /** Number of conflicted files of the current repository. */
  get conflicts(): number {
    return this.cur?.changes.filter(isConflicted).length ?? 0;
  }

  /** After a commit, ticks of that repository go back to their defaults. */
  async resetChoices(root = this.root): Promise<void> {
    const st = root ? this.states.get(root) : undefined;
    if (!st || !root) return;
    st.choices = {};
    await this.saveChoices(root);
  }

  // ---- Selection and targets of commands ------------------------------------------------------

  setSelection(keys: readonly string[]): void {
    this.selection = [...keys];
  }

  /** Files of the current repository among the selected rows. */
  private filesOf(keys: readonly string[]): WorkingChange[] {
    const st = this.cur;
    if (!st) return [];
    const seen = new Map<string, WorkingChange>();
    for (const k of keys) {
      const group = st.groups.find((g) => groupKey(st.root, g) === k);
      const files = group ? group.items : st.changes.filter((c) => fileKey(st.root, c.path) === k);
      for (const c of files) seen.set(c.path, c);
    }
    return [...seen.values()];
  }

  /**
   * Files a command acts on, in the current repository (the row's, see `reg` in extension.ts). A
   * menu or row button passes the row's context: the whole selection when it holds that row (like
   * Source Control), else that row alone. Without an argument (view title button, keybinding) the
   * selection. `{ path }` targets one file (tests, API).
   */
  targets(arg?: unknown): WorkingChange[] {
    if (isRowContext(arg)) {
      const key = keyOf(arg, this.root);
      return this.filesOf(this.selection.includes(key) ? this.selection : [key]);
    }
    const p = (arg as { path?: unknown } | undefined)?.path;
    if (typeof p === "string") return this.cur?.changes.filter((c) => c.path === p) ?? [];
    return this.filesOf(this.selection);
  }

  /** Changelist a row belongs to (undefined for unversioned files and conflicts). */
  listOf(arg: unknown): ChangeGroup | undefined {
    if (!isRowContext(arg) || !("list" in arg)) return undefined;
    const g = this.cur?.groups.find((x) => x.name === arg.list);
    return g && !g.unversioned && !g.conflicts ? g : undefined;
  }

  /** Moves tracked files to a changelist (drag and drop in the webview). */
  async move(root: string | undefined, paths: readonly string[], list: string): Promise<void> {
    const st = root ? this.states.get(root) : this.cur;
    if (!st) return;
    const target = st.groups.find((g) => g.name === list && !g.unversioned && !g.conflicts);
    const movable = new Set(
      st.changes.filter((c) => !isUntracked(c) && !isConflicted(c)).map((c) => c.path),
    );
    const files = paths.filter((p) => movable.has(p));
    if (!target || !files.length) return;
    await this.changelists.move(st.root, files, target.name);
    await this.refresh();
  }

  async openDiff(c: WorkingChange): Promise<void> {
    if (!this.root) return;
    const existsInHead = c.index !== "?" && c.index !== "A";
    const deleted = c.worktree === "D" || (c.index === "D" && c.worktree === " ");
    await openWorkingDiff(this.root, c.path, c.oldPath, existsInHead, deleted);
  }

  /** Header text: the repository (when several are open) and the branch. */
  where(): string {
    if (this.multi) return `${this.shown.length} repositories`;
    const repo = this.root && this.repos.roots().length > 1 ? path.basename(this.root) : "";
    return [repo, this.branch].filter(Boolean).join(" · ") + (this.ahead ? ` ↑${this.ahead}` : "");
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** An operation to finish, conflicts to resolve, or the error of the last refresh. */
function repoNotice(st: RepoState): string | undefined {
  if (st.error) return st.error;
  const conflicts = st.changes.filter(isConflicted).length;
  const label = st.operation && OPERATION_LABEL[st.operation];
  if (label)
    return `${label} in progress: ${conflicts ? `resolve ${plural(conflicts, "conflicted file")}, then Continue` : "Continue or Abort"} (buttons above).`;
  if (conflicts)
    return `${plural(conflicts, "conflicted file")}: resolve, then Mark Resolved (button above).`;
  return undefined;
}
