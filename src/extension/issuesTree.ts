// The Issues view: the open issues of the repository's remote (GitLab, GitHub), one flat list in
// the order the user picks (Sort By…).
import * as path from "path";
import * as vscode from "vscode";
import type { Issue } from "../shared/issues";
import { sortItems, type SortKey } from "../shared/sorting";
import type { Repos } from "./git/repos";
import { AuthRequired, findHosting, type Hosting, type HostingApi } from "./hosting";
import { openIssues } from "./issueApi";
import { sortLabel, SortSetting } from "./sortPick";

export const ISSUES_VIEW_ID = "gitTool.issues";
const NEEDS_AUTH = "gitTool.issues.needsAuth";

/** `root`: the repository of the node, for commands run on it (see `reg` in extension.ts). */
export type IssueNode =
  | { kind: "repo"; root: string; name: string }
  | { kind: "issue"; root: string; issue: Issue }
  | { kind: "note"; root: string; id: string; text: string; signIn?: boolean };

/** What one repository's remote returned. */
interface RepoIssues {
  hosting?: Hosting;
  issues: Issue[];
  /** The list was loaded (else a message or the sign-in buttons are shown). */
  loaded: boolean;
  message?: string;
  needsAuth?: boolean;
}

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : "");

export class IssuesTree implements vscode.TreeDataProvider<IssueNode>, vscode.Disposable {
  readonly view: vscode.TreeView<IssueNode>;
  hosting?: Hosting;
  private scopeKey?: string;
  private shown: string[] = [];
  private states = new Map<string, RepoIssues>();
  private readonly sort: SortSetting;
  /** The list needs reloading next time the view is shown. */
  private stale = true;
  private generation = 0;
  private readonly changed = new vscode.EventEmitter<IssueNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly repos: Repos,
    private readonly api: HostingApi,
    state: vscode.Memento,
  ) {
    this.sort = new SortSetting(state, "gitTool.issues.sort");
    this.view = vscode.window.createTreeView(ISSUES_VIEW_ID, { treeDataProvider: this });
    this.disposables.push(
      this.view,
      this.changed,
      this.view.onDidChangeVisibility((e) => {
        if (e.visible && this.stale) void this.refresh();
      }),
      api.onDidChangeCredentials(() => {
        this.stale = true;
        if (this.view.visible) void this.refresh();
      }),
      // Issues don't depend on the working tree: reload only for other repositories.
      repos.onDidChange(() => {
        if (this.repos.scopeKey() === this.scopeKey) return;
        this.stale = true;
        if (this.view.visible) void this.refresh();
      }),
    );
  }

  /** The current sort order (Sort By…). */
  sortKey(): SortKey {
    return this.sort.get();
  }

  async setSort(key: SortKey): Promise<void> {
    await this.sort.set(key);
    this.showDescription();
    this.changed.fire(undefined);
  }

  private showDescription(): void {
    this.view.description = [this.hosting?.path, `by ${sortLabel(this.sort.get())}`]
      .filter(Boolean)
      .join(" · ");
  }

  /** Reloads the lists from the hosting services. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.stale = false;
    const shown = this.repos.scopedRoots();
    this.scopeKey = this.repos.scopeKey();
    const states = new Map<string, RepoIssues>();
    await Promise.all(shown.map(async (root) => states.set(root, await this.load(root))));
    if (generation !== this.generation) return;
    this.shown = shown;
    this.states = states;
    // One repository: its message and sign-in buttons go on the view itself.
    const only = shown.length === 1 ? states.get(shown[0]) : undefined;
    this.hosting = only?.hosting;
    this.view.message = shown.length ? only?.message : "No Git repository is open.";
    const count = [...states.values()].reduce((n, s) => n + s.issues.length, 0);
    this.view.title = [...states.values()].some((s) => s.loaded) ? `Issues (${count})` : "Issues";
    void vscode.commands.executeCommand("setContext", NEEDS_AUTH, !!only?.needsAuth);
    this.showDescription();
    this.changed.fire(undefined);
  }

  private async load(root: string): Promise<RepoIssues> {
    const found = await findHosting(this.repos.git(root));
    if (!("hosting" in found)) return { issues: [], loaded: false, message: found.problem };
    const hosting = found.hosting;
    try {
      return { hosting, issues: await openIssues(this.api, hosting), loaded: true };
    } catch (e) {
      if (e instanceof AuthRequired) return { hosting, issues: [], loaded: false, needsAuth: true };
      return {
        hosting,
        issues: [],
        loaded: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** For the integration tests: the view's message and its issues. */
  summary(): { message?: string; issues: string[] } {
    return {
      message: this.view.message,
      issues: [...this.states.values()].flatMap((s) => s.issues.map((i) => `${i.id} ${i.title}`)),
    };
  }

  // ---- Tree data provider ---------------------------------------------------------------------

  getChildren(node?: IssueNode): IssueNode[] {
    if (!node) {
      if (this.shown.length > 1)
        return this.shown.map((root) => ({ kind: "repo", root, name: path.basename(root) }));
      return this.repoChildren(this.shown[0]);
    }
    return node.kind === "repo" ? this.repoChildren(node.root) : [];
  }

  /** The repository's issues, or why there are none. */
  private repoChildren(root: string | undefined): IssueNode[] {
    const state = root && this.states.get(root);
    if (!root || !state) return [];
    const multi = this.shown.length > 1;
    if (!state.loaded)
      return multi && (state.message || state.needsAuth)
        ? [
            {
              kind: "note",
              root,
              id: "unavailable",
              text: state.message ?? "Sign in to list the issues",
              signIn: state.needsAuth,
            },
          ]
        : [];
    const items = sortItems(state.issues, this.sort.get()).map((issue): IssueNode => ({
      kind: "issue",
      root,
      issue,
    }));
    return items.length ? items : [{ kind: "note", root, id: "none", text: "No open issues" }];
  }

  getTreeItem(node: IssueNode): vscode.TreeItem {
    switch (node.kind) {
      case "repo": {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `repo:${node.root}`;
        item.description = this.states.get(node.root)?.hosting?.path;
        item.iconPath = new vscode.ThemeIcon("repo");
        item.tooltip = node.root;
        return item;
      }
      case "issue":
        return this.issueItem(node);
      case "note": {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.id = `note:${node.root}:${node.id}`;
        if (node.signIn)
          item.command = {
            command: "gitTool.mergeRequests.signIn",
            title: "Sign In",
            arguments: [node],
          };
        return item;
      }
    }
  }

  private issueItem(node: Extract<IssueNode, { kind: "issue" }>): vscode.TreeItem {
    const i = node.issue;
    const ref = `#${i.id}`;
    const item = new vscode.TreeItem(i.title, vscode.TreeItemCollapsibleState.None);
    item.id = `issue:${node.root}:${i.id}`;
    item.description = [ref, i.authorName, i.labels.join(", ")].filter(Boolean).join(" · ");
    item.iconPath = new vscode.ThemeIcon(
      i.confidential ? "lock" : "issues",
      new vscode.ThemeColor("charts.green"),
    );
    item.contextValue = "issue";
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**${ref}** `).appendText(i.title);
    tip.appendMarkdown("\n\n").appendText(`By ${i.authorName}, opened ${when(i.createdAt)}`);
    tip.appendMarkdown("\n\n").appendText(`Updated ${when(i.updatedAt)}`);
    const extra = [
      i.confidential ? "confidential" : "",
      i.assignees.length ? `assignees: ${i.assignees.join(", ")}` : "",
      i.labels.length ? `labels: ${i.labels.join(", ")}` : "",
      i.milestone ? `milestone: ${i.milestone}` : "",
      i.dueDate ? `due ${i.dueDate}` : "",
      i.comments ? `${i.comments} comments` : "",
    ].filter(Boolean);
    if (extra.length) tip.appendMarkdown("\n\n").appendText(extra.join(" · "));
    if (i.description.trim()) {
      const text = i.description.length > 1500 ? `${i.description.slice(0, 1500)}…` : i.description;
      tip.appendMarkdown(`\n\n---\n\n${text}`);
    }
    item.tooltip = tip;
    return item;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
