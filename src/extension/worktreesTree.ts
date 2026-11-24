// The Worktrees view: every working tree of the repository, the one shown by the views marked.
// A click shows its commit in the Log; hover buttons and the context menu open (switch to) or
// delete it.
import * as path from "path";
import * as vscode from "vscode";
import { worktreeHeadLabel, type Worktree } from "../shared/worktrees";
import type { Repos } from "./git/repos";
import { listWorktrees, samePath } from "./worktrees";

export const WORKTREES_VIEW_ID = "gitTool.worktrees";

export interface WorktreeNode {
  kind: "worktree";
  /** Repository the worktree was listed from, for commands run on it. */
  root: string;
  worktree: Worktree;
  isCurrent: boolean;
  /** Folder of this workspace (its views can switch to it without reopening the window). */
  inWorkspace: boolean;
}

export class WorktreesTree implements vscode.TreeDataProvider<WorktreeNode>, vscode.Disposable {
  readonly view: vscode.TreeView<WorktreeNode>;
  private nodes: WorktreeNode[] = [];
  private fingerprint = "";
  private generation = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repos: Repos) {
    this.view = vscode.window.createTreeView(WORKTREES_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
    });
    this.disposables.push(
      this.view,
      this.changed,
      repos.onDidChange(() => void this.refresh()),
      this.view.onDidChangeVisibility((e) => e.visible && void this.refresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh(true)),
    );
  }

  async refresh(force = false): Promise<void> {
    const generation = ++this.generation;
    const root = this.repos.currentRoot();
    const shown = this.repos.scopedRoots();
    const listed: { root: string; worktree: Worktree }[] = [];
    try {
      const lists = await Promise.all(
        shown.map(async (r) => ({ root: r, list: await listWorktrees(this.repos.git(r)) })),
      );
      // Worktrees of one repository show up from each of its worktrees open in the workspace.
      for (const { root: r, list } of lists)
        for (const worktree of list)
          if (!listed.some((l) => samePath(l.worktree.path, worktree.path)))
            listed.push({ root: r, worktree });
    } catch (e) {
      this.view.message = e instanceof Error ? e.message : String(e);
      return;
    }
    if (generation !== this.generation) return;
    const roots = this.repos.roots();
    const nodes = listed
      .filter((l) => !l.worktree.bare)
      .map(({ root: from, worktree }): WorktreeNode => {
        const isCurrent = !!root && samePath(worktree.path, root);
        return {
          kind: "worktree",
          root: from,
          worktree,
          isCurrent,
          inWorkspace: !isCurrent && roots.some((r) => samePath(r, worktree.path)),
        };
      });
    const fingerprint = JSON.stringify([root, shown, nodes]);
    if (!force && fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.nodes = nodes;
    this.view.message = shown.length ? undefined : "No Git repository is open.";
    this.view.description = nodes.length > 1 ? String(nodes.length) : undefined;
    this.changed.fire();
  }

  /** Worktrees listed, for the integration tests: `folder:head[:current]`. */
  summary(): string[] {
    return this.nodes.map(
      (n) =>
        `${path.basename(n.worktree.path)}:${worktreeHeadLabel(n.worktree)}${n.isCurrent ? ":current" : ""}`,
    );
  }

  all(): WorktreeNode[] {
    return this.nodes;
  }

  getChildren(node?: WorktreeNode): WorktreeNode[] {
    return node ? [] : this.nodes;
  }

  getTreeItem(node: WorktreeNode): vscode.TreeItem {
    const w = node.worktree;
    const item = new vscode.TreeItem(path.basename(w.path), vscode.TreeItemCollapsibleState.None);
    item.id = `worktree:${w.path}`;
    item.description = [
      worktreeHeadLabel(w),
      node.isCurrent ? "current" : "",
      w.main ? "main" : "",
      w.locked !== undefined ? "locked" : "",
      w.prunable ? "missing" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    item.iconPath = new vscode.ThemeIcon(
      w.prunable ? "warning" : node.isCurrent ? "check" : w.main ? "repo" : "folder",
      node.isCurrent
        ? new vscode.ThemeColor("gitDecoration.addedResourceForeground")
        : w.prunable
          ? new vscode.ThemeColor("list.warningForeground")
          : undefined,
    );
    item.tooltip = [
      w.path,
      w.branch ? `Branch ${w.branch}` : w.head ? `Detached at ${w.head.slice(0, 8)}` : "",
      w.main ? "Main working tree" : "",
      w.locked !== undefined ? `Locked${w.locked ? `: ${w.locked}` : ""}` : "",
      w.prunable ? `Missing: ${w.prunable}` : "",
      node.inWorkspace ? "Folder of this workspace" : "",
    ]
      .filter(Boolean)
      .join("\n");
    // What the menus may offer, e.g. `worktree-canOpen-canSwitch-canAdd-canDelete`.
    const canOpen = !w.prunable;
    const canSwitch = canOpen && !node.isCurrent;
    item.contextValue = [
      "worktree",
      canOpen ? "canOpen" : "",
      canSwitch ? "canSwitch" : "",
      canSwitch && !node.inWorkspace ? "canAdd" : "",
      !w.main && !node.isCurrent ? "canDelete" : "",
    ]
      .filter(Boolean)
      .join("-");
    if (w.head)
      item.command = {
        command: "gitTool.worktree.showInLog",
        title: "Show in Log",
        arguments: [node],
      };
    return item;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
