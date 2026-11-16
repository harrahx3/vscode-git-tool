// The Compare view (PyCharm's "Compare with Current"): commits only on each side and the files
// that differ between two branches, tags or revisions. A click on a file opens its diff, a click
// on a commit shows it in the Log.
import * as path from "path";
import * as vscode from "vscode";
import { displayRef } from "../shared/selection";
import type { ChangedFile, Commit, FileStatus } from "../shared/types";
import { compareRefs, type Comparison } from "./git/queries";
import type { Repos } from "./git/repos";
import { revisionUri, shortHash } from "./revisions";

export const COMPARE_VIEW_ID = "gitTool.compare";
const COMPARING = "gitTool.comparing";
/** URIs of compared files: the file icon comes from the name, the badge from the status. */
export const STATUS_SCHEME = "git-tool-status";

export type CompareNode =
  | { kind: "group"; side: "left" | "right" | "files" }
  /** `hash` and `parents` make it a valid argument for the Log's commit commands. */
  | { kind: "commit"; commit: Commit; hash: string; parents: string[] }
  | { kind: "file"; file: ChangedFile };

const STATUS: Partial<Record<FileStatus, [string, string]>> = {
  M: ["Modified", "gitDecoration.modifiedResourceForeground"],
  A: ["Added", "gitDecoration.addedResourceForeground"],
  D: ["Deleted", "gitDecoration.deletedResourceForeground"],
  R: ["Renamed", "gitDecoration.renamedResourceForeground"],
  C: ["Copied", "gitDecoration.addedResourceForeground"],
  T: ["Type changed", "gitDecoration.modifiedResourceForeground"],
};

const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export class CompareView
  implements vscode.TreeDataProvider<CompareNode>, vscode.FileDecorationProvider, vscode.Disposable
{
  readonly view: vscode.TreeView<CompareNode>;
  private root?: string;
  left?: string;
  right?: string;
  private result?: Comparison;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repos: Repos) {
    this.view = vscode.window.createTreeView(COMPARE_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: false,
      showCollapseAll: true,
    });
    this.disposables.push(
      this.view,
      this.changed,
      vscode.window.registerFileDecorationProvider(this),
      repos.onDidChange(() => {
        if (this.left && this.right) void this.refresh();
      }),
    );
  }

  /** Compares two refs and shows the view. */
  async compare(left: string, right: string): Promise<void> {
    const root = this.repos.currentRoot();
    if (!root) return;
    this.root = root;
    this.left = left;
    this.right = right;
    await vscode.commands.executeCommand("setContext", COMPARING, true);
    await this.refresh();
    await vscode.commands.executeCommand(`${COMPARE_VIEW_ID}.focus`);
  }

  async refresh(): Promise<void> {
    if (!this.root || !this.left || !this.right) return;
    const [left, right] = [this.left, this.right];
    try {
      const result = await compareRefs(this.repos.git(this.root), left, right);
      if (left !== this.left || right !== this.right) return;
      this.result = result;
      this.view.message = result.truncated
        ? "Only the 1 000 most recent commits of each side are listed."
        : undefined;
    } catch (e) {
      this.result = undefined;
      this.view.message = e instanceof Error ? e.message : String(e);
    }
    this.view.title = "Compare";
    this.view.description = `${displayRef(left)} ↔ ${displayRef(right)}`;
    this.changed.fire();
  }

  swap(): Promise<void> {
    if (!this.left || !this.right) return Promise.resolve();
    return this.compare(this.right, this.left);
  }

  async close(): Promise<void> {
    this.left = this.right = this.result = undefined;
    this.view.description = undefined;
    this.view.message = undefined;
    this.changed.fire();
    await vscode.commands.executeCommand("setContext", COMPARING, false);
  }

  /** For the integration tests. */
  summary(): { onlyLeft: string[]; onlyRight: string[]; files: string[] } | undefined {
    const r = this.result;
    return (
      r && {
        onlyLeft: r.onlyLeft.map((c) => c.subject),
        onlyRight: r.onlyRight.map((c) => c.subject),
        files: r.files.map((f) => `${f.status} ${f.path}`),
      }
    );
  }

  // ---- Tree data provider ---------------------------------------------------------------------

  getChildren(node?: CompareNode): CompareNode[] {
    const r = this.result;
    if (!r) return [];
    if (!node)
      return [
        { kind: "group", side: "left" },
        { kind: "group", side: "right" },
        { kind: "group", side: "files" },
      ];
    if (node.kind !== "group") return [];
    if (node.side === "files") return r.files.map((file) => ({ kind: "file", file }));
    const commits = node.side === "left" ? r.onlyLeft : r.onlyRight;
    return commits.map((c) => ({ kind: "commit", commit: c, hash: c.hash, parents: c.parents }));
  }

  getTreeItem(node: CompareNode): vscode.TreeItem {
    switch (node.kind) {
      case "group":
        return this.groupItem(node.side);
      case "commit":
        return this.commitItem(node.commit);
      case "file":
        return this.fileItem(node);
    }
  }

  private groupItem(side: "left" | "right" | "files"): vscode.TreeItem {
    const r = this.result!;
    const left = displayRef(this.left ?? "");
    const right = displayRef(this.right ?? "");
    const [label, count, icon] =
      side === "files"
        ? [`Files changed`, r.files.length, "files"]
        : side === "left"
          ? [`Only in ${left}`, r.onlyLeft.length, "arrow-left"]
          : [`Only in ${right}`, r.onlyRight.length, "arrow-right"];
    const item = new vscode.TreeItem(
      label,
      count ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    item.id = `group:${side}`;
    item.description = side === "files" ? `${count} · ${left} → ${right}` : `${count}`;
    item.iconPath = new vscode.ThemeIcon(icon);
    item.contextValue = "compareGroup";
    item.tooltip =
      side === "files"
        ? `Files that differ from ${left} to ${right}`
        : side === "left"
          ? `Commits in ${left} that are not in ${right}`
          : `Commits in ${right} that are not in ${left}`;
    return item;
  }

  private commitItem(c: Commit): vscode.TreeItem {
    const item = new vscode.TreeItem(c.subject, vscode.TreeItemCollapsibleState.None);
    item.id = `commit:${c.hash}`;
    item.description = `${shortHash(c.hash)} · ${c.author} · ${date(c.authorTime)}`;
    item.tooltip = new vscode.MarkdownString().appendText(
      `${c.subject}\n\n${c.author} <${c.email}>, ${new Date(c.authorTime * 1000).toLocaleString()}\n${c.hash}`,
    );
    item.iconPath = new vscode.ThemeIcon(c.parents.length > 1 ? "git-merge" : "git-commit");
    item.contextValue = "compareCommit";
    item.command = {
      command: "gitTool.showCommitInLog",
      title: "Show in Log",
      arguments: [c.hash],
    };
    return item;
  }

  private fileItem(node: Extract<CompareNode, { kind: "file" }>): vscode.TreeItem {
    const f = node.file;
    const slash = f.path.lastIndexOf("/");
    const item = new vscode.TreeItem(
      vscode.Uri.from({ scheme: STATUS_SCHEME, path: `/${f.path}`, query: f.status }),
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `file:${f.path}`;
    item.label = f.path.slice(slash + 1);
    item.description = [f.oldPath ? `← ${f.oldPath}` : "", slash >= 0 ? f.path.slice(0, slash) : ""]
      .filter(Boolean)
      .join("  ");
    item.tooltip = `${f.oldPath ? `${f.oldPath} → ` : ""}${f.path} • ${STATUS[f.status]?.[0] ?? f.status}`;
    item.contextValue = f.status === "D" ? "compareFile.deleted" : "compareFile";
    item.command = { command: "gitTool.compare.diff", title: "Show Diff", arguments: [node] };
    return item;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== STATUS_SCHEME) return undefined;
    const status = STATUS[uri.query as FileStatus];
    return (
      status && new vscode.FileDecoration(uri.query, status[0], new vscode.ThemeColor(status[1]))
    );
  }

  // ---- Actions --------------------------------------------------------------------------------

  /** Diff of a file from the left ref to the right ref. */
  async openDiff(node: unknown): Promise<void> {
    const f =
      (node as CompareNode | undefined)?.kind === "file" && (node as { file: ChangedFile }).file;
    if (!f || !this.root || !this.left || !this.right) return;
    const leftUri = revisionUri(this.root, f.status === "A" ? "" : this.left, f.oldPath ?? f.path);
    const rightUri = revisionUri(this.root, f.status === "D" ? "" : this.right, f.path);
    const title = `${path.basename(f.path)} (${displayRef(this.left)} ↔ ${displayRef(this.right)})`;
    await vscode.commands.executeCommand("vscode.diff", leftUri, rightUri, title, {
      preview: true,
    });
  }

  /** Diff of the right ref's version against the working-tree file. */
  async compareWithLocal(node: unknown): Promise<void> {
    const f =
      (node as CompareNode | undefined)?.kind === "file" && (node as { file: ChangedFile }).file;
    if (!f || !this.root || !this.right || f.status === "D") return;
    const local = vscode.Uri.file(path.join(this.root, f.path));
    const title = `${path.basename(f.path)} (${displayRef(this.right)} ↔ working tree)`;
    await vscode.commands.executeCommand(
      "vscode.diff",
      revisionUri(this.root, this.right, f.path),
      local,
      title,
      { preview: true },
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
