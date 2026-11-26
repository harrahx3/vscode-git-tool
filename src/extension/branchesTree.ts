// The Branches view: PyCharm's branches tree as a native view — HEAD, Local, Remote, Tags, names
// split into folders on "/", ahead/behind counts, the current branch marked. A click shows the branch's
// commit in the Log; the context menu holds checkout, new branch, compare, merge, rebase, etc.
import * as path from "path";
import * as vscode from "vscode";
import { buildFolders, sortedFolders, sortedRefs, type RefFolder } from "../shared/refFolders";
import type { HeadInfo, Ref, RefKind } from "../shared/types";
import { head, refs } from "./git/queries";
import type { Repos } from "./git/repos";

export const BRANCHES_VIEW_ID = "gitTool.branches";

/** `root`: the repository of the node, for commands run on it (see `reg` in extension.ts). */
export type BranchNode =
  /** One repository, when the view lists several (workspace scope "all"). */
  | { kind: "repo"; root: string; name: string }
  /** HEAD at the top, as in PyCharm: `refName` is the current branch, or the commit if detached. */
  | { kind: "head"; root: string; ref: Ref; refName: string; refKind: "head"; branch?: string }
  | { kind: "section"; root: string; refKind: RefKind; count: number }
  | {
      kind: "folder";
      root: string;
      refKind: RefKind;
      key: string;
      label: string;
      folder: RefFolder;
    }
  /** `refName`/`refKind` make it a valid argument for the `gitTool.ref.*` commands. */
  | {
      kind: "ref";
      root: string;
      ref: Ref;
      refName: string;
      refKind: RefKind;
      leaf: string;
      isCurrent: boolean;
    };

const SECTIONS: [RefKind, string][] = [
  ["head", "Local"],
  ["remote", "Remote"],
  ["tag", "Tags"],
];

interface RepoData {
  head: HeadInfo;
  refs: Ref[];
}

export class BranchesTree implements vscode.TreeDataProvider<BranchNode>, vscode.Disposable {
  readonly view: vscode.TreeView<BranchNode>;
  private data = new Map<string, RepoData>();
  /** Repositories listed, in order. */
  private shown: string[] = [];
  private fingerprint = "";
  private generation = 0;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repos: Repos) {
    this.view = vscode.window.createTreeView(BRANCHES_VIEW_ID, {
      treeDataProvider: this,
      canSelectMany: true,
      showCollapseAll: true,
    });
    this.disposables.push(
      this.view,
      this.changed,
      repos.onDidChange(() => void this.refresh()),
    );
  }

  async refresh(force = false): Promise<void> {
    const generation = ++this.generation;
    const shown = this.repos.scopedRoots();
    const data = new Map<string, RepoData>();
    try {
      await Promise.all(
        shown.map(async (root) => {
          const git = this.repos.git(root);
          const [h, r] = await Promise.all([head(git), refs(git)]);
          data.set(root, { head: h, refs: r });
        }),
      );
    } catch (e) {
      this.view.message = e instanceof Error ? e.message : String(e);
      return;
    }
    if (generation !== this.generation) return;
    const fingerprint = JSON.stringify([shown, [...data]]);
    if (!force && fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.shown = shown;
    this.data = data;
    this.view.message = shown.length ? undefined : "No Git repository is open.";
    // Local and remote branches counted apart (tags left out), so the sizes show when folded.
    const count = (kind: string) =>
      [...data.values()].reduce((n, d) => n + d.refs.filter((r) => r.kind === kind).length, 0);
    this.view.title = `Branches (${count("head")} local · ${count("remote")} remote)`;
    this.changed.fire();
  }

  private of(root: string): RepoData {
    return this.data.get(root) ?? { head: {}, refs: [] };
  }

  /** The repository whose refs the integration tests read: the current one. */
  private currentData(): RepoData {
    const root = this.repos.currentRoot();
    return this.of(root && this.data.has(root) ? root : (this.shown[0] ?? ""));
  }

  /** Ref names, HEAD first (`HEAD:<branch>` or `HEAD:detached`), for the integration tests. */
  names(): string[] {
    const root = this.repos.currentRoot() ?? this.shown[0] ?? "";
    const headNode = this.headNode(root);
    return [
      ...(headNode ? [`HEAD:${headNode.branch ?? "detached"}`] : []),
      ...this.currentData().refs.map((r) => `${r.kind}:${r.name}`),
    ];
  }

  currentBranch(): string | undefined {
    return this.currentData().head.branch;
  }

  // ---- Tree data provider ---------------------------------------------------------------------

  /** The HEAD node, when the repository has a commit. */
  private headNode(root: string): Extract<BranchNode, { kind: "head" }> | undefined {
    const { head: h, refs } = this.of(root);
    const { branch, hash } = h;
    if (!hash) return undefined;
    const current = refs.find((r) => r.kind === "head" && r.name === branch);
    const ref: Ref = current ?? { name: "HEAD", kind: "head", hash };
    return { kind: "head", root, ref, refName: branch ?? hash, refKind: "head", branch };
  }

  getChildren(node?: BranchNode): BranchNode[] {
    if (!node) {
      if (this.shown.length > 1)
        return this.shown.map((root) => ({ kind: "repo", root, name: path.basename(root) }));
      return this.topLevel(this.shown[0]);
    }
    if (node.kind === "repo") return this.topLevel(node.root);
    if (node.kind === "ref" || node.kind === "head") return [];
    const { root } = node;
    const { head: h, refs } = this.of(root);
    const folder =
      node.kind === "section"
        ? buildFolders(refs.filter((r) => r.kind === node.refKind))
        : node.folder;
    const prefix = node.kind === "section" ? "" : `${node.key}/`;
    return [
      ...sortedFolders(folder).map(([label, sub]): BranchNode => ({
        kind: "folder",
        root,
        refKind: node.refKind,
        key: `${prefix}${label}`,
        label,
        folder: sub,
      })),
      ...sortedRefs(folder).map(({ ref, leaf }): BranchNode => ({
        kind: "ref",
        root,
        ref,
        refName: ref.name,
        refKind: ref.kind,
        leaf,
        isCurrent: ref.kind === "head" && ref.name === h.branch,
      })),
    ];
  }

  /** HEAD and the Local, Remote and Tags sections of a repository. */
  private topLevel(root: string | undefined): BranchNode[] {
    if (!root) return [];
    const headNode = this.headNode(root);
    const { refs } = this.of(root);
    const sections = SECTIONS.map(([refKind]) => ({
      kind: "section" as const,
      root,
      refKind,
      count: refs.filter((r) => r.kind === refKind).length,
    })).filter((s) => s.count > 0);
    return [...(headNode ? [headNode] : []), ...sections];
  }

  getTreeItem(node: BranchNode): vscode.TreeItem {
    if (node.kind === "repo") {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `repo:${node.root}`;
      item.description = this.of(node.root).head.branch;
      item.iconPath = new vscode.ThemeIcon("repo");
      item.tooltip = node.root;
      item.contextValue = "repo";
      return item;
    }
    if (node.kind === "head") return this.headItem(node);
    if (node.kind === "section") {
      const title = SECTIONS.find(([k]) => k === node.refKind)![1];
      const item = new vscode.TreeItem(
        title,
        node.refKind === "tag"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `${node.root}:section:${node.refKind}`;
      item.description = String(node.count);
      item.contextValue = `section-${node.refKind}`;
      return item;
    }
    if (node.kind === "folder") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `${node.root}:folder:${node.refKind}:${node.key}`;
      item.iconPath = vscode.ThemeIcon.Folder;
      item.contextValue = "folder";
      return item;
    }
    return this.refItem(node);
  }

  private headItem(node: Extract<BranchNode, { kind: "head" }>): vscode.TreeItem {
    const { ref, branch } = node;
    const item = new vscode.TreeItem("HEAD", vscode.TreeItemCollapsibleState.None);
    item.id = `${node.root}:head`;
    item.description = [branch ?? `detached at ${ref.hash.slice(0, 8)}`, tracking(ref)]
      .filter(Boolean)
      .join(" · ");
    item.iconPath = new vscode.ThemeIcon("target");
    item.tooltip = [
      branch ? `HEAD → ${branch} (current branch)` : "HEAD (detached)",
      ref.upstream ? `Tracks ${ref.upstream}` : "",
      `Commit ${ref.hash.slice(0, 8)}`,
    ]
      .filter(Boolean)
      .join("\n");
    item.contextValue = branch ? "head-branch" : "head-detached";
    item.command = { command: "gitTool.ref.showInLog", title: "Show in Log", arguments: [node] };
    return item;
  }

  private refItem(node: Extract<BranchNode, { kind: "ref" }>): vscode.TreeItem {
    const { ref, isCurrent } = node;
    const item = new vscode.TreeItem(node.leaf, vscode.TreeItemCollapsibleState.None);
    item.id = `${node.root}:ref:${ref.kind}:${ref.name}`;
    const unpushed = ref.kind === "tag" && ref.pushed === false;
    item.description = [isCurrent ? "current" : "", tracking(ref), unpushed ? "local only" : ""]
      .filter(Boolean)
      .join(" · ");
    item.iconPath = new vscode.ThemeIcon(
      ref.kind === "tag"
        ? "tag"
        : isCurrent
          ? "check"
          : ref.kind === "remote"
            ? "cloud"
            : "git-branch",
      isCurrent ? new vscode.ThemeColor("gitDecoration.addedResourceForeground") : undefined,
    );
    const tooltip = [
      ref.name,
      ref.upstream ? `Tracks ${ref.upstream}` : "",
      ref.ahead ? `${ref.ahead} commit(s) to push` : "",
      ref.behind ? `${ref.behind} commit(s) to pull` : "",
      `Commit ${ref.hash.slice(0, 8)}`,
    ];
    item.tooltip = tooltip.filter(Boolean).join("\n");
    item.contextValue = `ref-${ref.kind}${isCurrent ? "-current" : ""}`;
    item.command = {
      command: "gitTool.ref.showInLog",
      title: "Show in Log",
      arguments: [node],
    };
    return item;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** Commits to push and to pull, e.g. "↑2 ↓1". */
function tracking(ref: Ref): string {
  return [ref.ahead ? `↑${ref.ahead}` : "", ref.behind ? `↓${ref.behind}` : ""]
    .filter(Boolean)
    .join(" ");
}
