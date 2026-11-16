// The changed files of the Commit view: changelists with their files, the "include in commit"
// ticks (PyCharm semantics), the selection made in the webview, and what menu commands act on.
// The Commit webview (commitView.ts) draws them under the message box.
import * as path from "path";
import * as vscode from "vscode";
import {
  groupChanges,
  isConflicted,
  isIncluded,
  isUntracked,
  pruneChoices,
  type ChangeGroup,
} from "../shared/changeGroups";
import type { ChangeListView, RowContext } from "../shared/messages";
import { changeKind } from "../shared/parse";
import type { WorkingChange } from "../shared/types";
import type { Changelists } from "./changelists";
import { OPERATION_LABEL, currentOperation, type Operation } from "./git/operations";
import { head, lastMessage, refs, status } from "./git/queries";
import type { Repos } from "./git/repos";
import { openWorkingDiff } from "./revisions";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const groupKey = (g: ChangeGroup) =>
  g.conflicts ? "conflicts" : g.unversioned ? "unversioned" : `list:${g.name}`;
const fileKey = (p: string) => `file:${p}`;

/** Selection key of the row a menu or button was used on. */
function keyOf(ctx: RowContext): string {
  switch (ctx.webviewSection) {
    case "change":
      return fileKey(ctx.path);
    case "changelist":
      return `list:${ctx.list}`;
    default:
      return ctx.webviewSection;
  }
}

function isRowContext(x: unknown): x is RowContext {
  const s = (x as { webviewSection?: unknown } | undefined)?.webviewSection;
  return s === "change" || s === "changelist" || s === "unversioned" || s === "conflicts";
}

export class Changes implements vscode.Disposable {
  root?: string;
  branch?: string;
  ahead?: number;
  lastMessage?: string;
  /** The merge, rebase, cherry-pick or revert that stopped half-way. */
  operation?: Operation;
  /** Error of the last refresh, shown in the view. */
  error?: string;
  private changes: WorkingChange[] = [];
  private groups: ChangeGroup[] = [];
  /** Explicit checkbox choices of the current repository, path → included. */
  private choices: Record<string, boolean> = {};
  /** Rows selected in the webview (`file:<path>` and group keys). */
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

  private async load(): Promise<void> {
    const generation = ++this.generation;
    const root = this.repos.currentRoot();
    if (root !== this.root) {
      this.root = root;
      this.choices = root ? { ...this.memento.get(`checked:${root}`, {}) } : {};
      this.selection = [];
    }
    if (!root) {
      this.update([], [], undefined, undefined, undefined);
      return;
    }
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
      if (generation !== this.generation) return;
      const branch = allRefs.find((r) => r.kind === "head" && r.name === h.branch);
      if (pruneChoices(this.choices, changes)) void this.saveChoices();
      this.operation = operation;
      this.error = undefined;
      this.update(
        changes,
        groupChanges(changes, lists.changelists, lists.assignment),
        h.branch ?? (h.hash ? `detached at ${h.hash.slice(0, 8)}` : undefined),
        branch?.upstream ? (branch.ahead ?? 0) : undefined,
        last,
      );
    } catch (e) {
      if (generation !== this.generation) return;
      this.error = e instanceof Error ? e.message : String(e);
      this.stateChanged.fire();
    }
  }

  private update(
    changes: WorkingChange[],
    groups: ChangeGroup[],
    branch: string | undefined,
    ahead: number | undefined,
    last: string | undefined,
  ): void {
    this.changes = changes;
    this.groups = groups;
    this.branch = branch;
    this.ahead = ahead;
    this.lastMessage = last;
    const known = new Set([...groups.map(groupKey), ...changes.map((c) => fileKey(c.path))]);
    this.selection = this.selection.filter((k) => known.has(k));
    const op = this.root ? this.operation : undefined;
    void vscode.commands.executeCommand("setContext", "gitTool.operation", op ?? "");
    void vscode.commands.executeCommand("setContext", "gitTool.conflicts", this.conflicts > 0);
    this.stateChanged.fire();
  }

  /** The groups and files as the webview draws them. */
  lists(): ChangeListView[] {
    return this.groups.map((g) => ({
      key: groupKey(g),
      name: g.name,
      kind: g.conflicts ? "conflicts" : g.unversioned ? "unversioned" : "changelist",
      active: g.active,
      files: g.items.map((c) => ({
        path: c.path,
        oldPath: c.oldPath,
        status: changeKind(c),
        included: this.included(c),
        untracked: isUntracked(c),
        conflict: isConflicted(c),
      })),
    }));
  }

  /** Line above the list: no repository, an operation or conflicts to finish, no changes. */
  notice(): string | undefined {
    if (!this.root) return "No Git repository is open.";
    if (this.error) return this.error;
    const conflicts = this.conflicts;
    const label = this.operation && OPERATION_LABEL[this.operation];
    if (label)
      return `${label} in progress: ${conflicts ? `resolve ${plural(conflicts, "conflicted file")}, then Continue` : "Continue or Abort"} (buttons above).`;
    if (conflicts)
      return `${plural(conflicts, "conflicted file")}: resolve, then Mark Resolved (button above).`;
    return this.changes.length ? undefined : "No changes.";
  }

  // ---- Ticks ----------------------------------------------------------------------------------

  private included(c: WorkingChange): boolean {
    return isIncluded(c, this.choices, this.groups);
  }

  /** Ticks or unticks files (the webview expands a group or a selection into its files). */
  async include(paths: readonly string[], on: boolean): Promise<void> {
    const known = new Set(this.changes.filter((c) => !isConflicted(c)).map((c) => c.path));
    for (const p of paths) if (known.has(p)) this.choices[p] = on;
    await this.saveChoices();
    this.stateChanged.fire();
  }

  private saveChoices(): Thenable<void> {
    return this.root
      ? this.memento.update(`checked:${this.root}`, this.choices)
      : Promise.resolve();
  }

  /** Paths ticked for the next commit. */
  includedPaths(): string[] {
    return this.changes.filter((c) => this.included(c)).map((c) => c.path);
  }

  get total(): number {
    return this.changes.length;
  }

  /** Number of conflicted files. */
  get conflicts(): number {
    return this.changes.filter(isConflicted).length;
  }

  /** After a commit, ticks go back to their defaults. */
  async resetChoices(): Promise<void> {
    this.choices = {};
    await this.saveChoices();
  }

  // ---- Selection and targets of commands ------------------------------------------------------

  setSelection(keys: readonly string[]): void {
    this.selection = [...keys];
  }

  private filesOf(keys: readonly string[]): WorkingChange[] {
    const seen = new Map<string, WorkingChange>();
    for (const k of keys) {
      const group = this.groups.find((g) => groupKey(g) === k);
      const files = group
        ? group.items
        : this.changes.filter((c) => k.startsWith("file:") && fileKey(c.path) === k);
      for (const c of files) seen.set(c.path, c);
    }
    return [...seen.values()];
  }

  /**
   * Files a command acts on. A menu or row button passes the row's context: the whole selection
   * when it holds that row (like Source Control), else that row alone. Without an argument (view
   * title button, keybinding) the selection. `{ path }` targets one file (tests, API).
   */
  targets(arg?: unknown): WorkingChange[] {
    if (isRowContext(arg)) {
      const key = keyOf(arg);
      return this.filesOf(this.selection.includes(key) ? this.selection : [key]);
    }
    const p = (arg as { path?: unknown } | undefined)?.path;
    if (typeof p === "string") return this.changes.filter((c) => c.path === p);
    return this.filesOf(this.selection);
  }

  /** Changelist a row belongs to (undefined for unversioned files and conflicts). */
  listOf(arg: unknown): ChangeGroup | undefined {
    if (!isRowContext(arg) || !("list" in arg)) return undefined;
    const g = this.groups.find((x) => x.name === arg.list);
    return g && !g.unversioned && !g.conflicts ? g : undefined;
  }

  /** Moves tracked files to a changelist (drag and drop in the webview). */
  async move(paths: readonly string[], list: string): Promise<void> {
    const target = this.groups.find((g) => g.name === list && !g.unversioned && !g.conflicts);
    const movable = new Set(
      this.changes.filter((c) => !isUntracked(c) && !isConflicted(c)).map((c) => c.path),
    );
    const files = paths.filter((p) => movable.has(p));
    if (!target || !files.length || !this.root) return;
    await this.changelists.move(this.root, files, target.name);
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
    const repo = this.root && this.repos.roots().length > 1 ? path.basename(this.root) : "";
    return [repo, this.branch].filter(Boolean).join(" · ") + (this.ahead ? ` ↑${this.ahead}` : "");
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
