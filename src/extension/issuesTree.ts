// The Issues view: the open issues of the repository's remote (GitLab, GitHub), one flat list in
// the order the user picks (Sort By…).
import * as vscode from "vscode";
import type { Issue } from "../shared/issues";
import { sortItems, type SortKey } from "../shared/sorting";
import type { Repos } from "./git/repos";
import { AuthRequired, findHosting, type Hosting, type HostingApi } from "./hosting";
import { openIssues } from "./issueApi";
import { sortLabel, SortSetting } from "./sortPick";

export const ISSUES_VIEW_ID = "gitTool.issues";
const NEEDS_AUTH = "gitTool.issues.needsAuth";

export type IssueNode =
  { kind: "issue"; issue: Issue } | { kind: "note"; id: string; text: string };

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : "");

export class IssuesTree implements vscode.TreeDataProvider<IssueNode>, vscode.Disposable {
  readonly view: vscode.TreeView<IssueNode>;
  hosting?: Hosting;
  private root?: string;
  private issues: Issue[] = [];
  /** The list was loaded (else a message or the sign-in buttons are shown). */
  private loaded = false;
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
      // Issues don't depend on the working tree: reload only for another repository.
      repos.onDidChange(() => {
        if (this.repos.currentRoot() === this.root) return;
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

  /** Reloads the list from the hosting service. */
  async refresh(): Promise<void> {
    const generation = ++this.generation;
    this.stale = false;
    const root = this.repos.currentRoot();
    this.root = root;
    const show = (message: string | undefined, needsAuth = false) => {
      if (generation !== this.generation) return;
      this.view.message = message;
      void vscode.commands.executeCommand("setContext", NEEDS_AUTH, needsAuth);
      this.changed.fire(undefined);
    };
    this.issues = [];
    this.loaded = false;
    if (!root) return show("No Git repository is open.");
    const found = await findHosting(this.repos.git(root));
    if (!("hosting" in found)) {
      this.hosting = undefined;
      return show(found.problem);
    }
    const h = (this.hosting = found.hosting);
    this.showDescription();
    try {
      const issues = await openIssues(this.api, h);
      if (generation !== this.generation) return;
      this.issues = issues;
      this.loaded = true;
      show(undefined);
    } catch (e) {
      if (e instanceof AuthRequired) return show(undefined, true);
      show(e instanceof Error ? e.message : String(e));
    }
  }

  /** For the integration tests: the view's message and its issues. */
  summary(): { message?: string; issues: string[] } {
    return { message: this.view.message, issues: this.issues.map((i) => `${i.id} ${i.title}`) };
  }

  // ---- Tree data provider ---------------------------------------------------------------------

  getChildren(node?: IssueNode): IssueNode[] {
    if (node || !this.loaded) return [];
    const items = sortItems(this.issues, this.sort.get()).map((issue): IssueNode => ({
      kind: "issue",
      issue,
    }));
    return items.length ? items : [{ kind: "note", id: "none", text: "No open issues" }];
  }

  getTreeItem(node: IssueNode): vscode.TreeItem {
    switch (node.kind) {
      case "issue":
        return this.issueItem(node);
      case "note": {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.id = `note:${node.id}`;
        return item;
      }
    }
  }

  private issueItem(node: Extract<IssueNode, { kind: "issue" }>): vscode.TreeItem {
    const i = node.issue;
    const ref = `#${i.id}`;
    const item = new vscode.TreeItem(i.title, vscode.TreeItemCollapsibleState.None);
    item.id = `issue:${i.id}`;
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
