// The Merge Requests view: the open merge requests (GitLab) or pull requests (GitHub) of the
// repository's remote, one flat list in the order the user picks (Sort By…). The current branch's
// merge request is marked. Expanding one lists its changed files (fetched into the local
// repository); a click on a file opens its diff.
import * as path from "path";
import * as vscode from "vscode";
import { statusText, type MergeRequest } from "../shared/mergeRequests";
import { parseNameStatus } from "../shared/parse";
import { mergeRequestHeadRef, mergeRequestRef, mergeRequestWord } from "../shared/remote";
import { sortItems, type SortKey } from "../shared/sorting";
import type { ChangedFile } from "../shared/types";
import { STATUS_SCHEME } from "./compareView";
import { head } from "./git/queries";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import { AuthRequired, findHosting, type Hosting, type HostingApi } from "./hosting";
import { openMergeRequests } from "./mergeRequestApi";
import { revisionUri } from "./revisions";
import { sortLabel, SortSetting } from "./sortPick";

export const MERGE_REQUESTS_VIEW_ID = "gitTool.mergeRequests";
const NEEDS_AUTH = "gitTool.mergeRequests.needsAuth";

/** The merge request's changes: from the merge base with the target to the source's head. */
export interface MergeRequestChanges {
  base: string;
  head: string;
  files: ChangedFile[];
}

export type MrNode =
  | { kind: "mr"; mr: MergeRequest }
  | { kind: "file"; mr: MergeRequest; file: ChangedFile; base: string; head: string }
  | { kind: "note"; id: string; text: string; error?: boolean };

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : "");

export class MergeRequestsTree implements vscode.TreeDataProvider<MrNode>, vscode.Disposable {
  readonly view: vscode.TreeView<MrNode>;
  hosting?: Hosting;
  private root?: string;
  private mrs: MergeRequest[] = [];
  private branch?: string;
  /** The list was loaded (else a message or the sign-in buttons are shown). */
  private loaded = false;
  private readonly sort: SortSetting;
  /** The list needs reloading next time the view is shown. */
  private stale = true;
  private generation = 0;
  private readonly changes = new Map<number, Promise<MergeRequestChanges>>();
  private readonly fetchedTargets = new Set<string>();
  /** git fetch runs one at a time (FETCH_HEAD and ref locks). */
  private fetchQueue: Promise<unknown> = Promise.resolve();
  private readonly changed = new vscode.EventEmitter<MrNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly repos: Repos,
    private readonly api: HostingApi,
    state: vscode.Memento,
  ) {
    this.sort = new SortSetting(state, "gitTool.mergeRequests.sort");
    this.view = vscode.window.createTreeView(MERGE_REQUESTS_VIEW_ID, {
      treeDataProvider: this,
      showCollapseAll: true,
    });
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
      // Git changes often: reload only for another repository; re-mark on a branch switch.
      repos.onDidChange(() => void this.onRepositoryChange()),
    );
  }

  private async onRepositoryChange(): Promise<void> {
    const root = this.repos.currentRoot();
    if (root !== this.root) {
      this.stale = true;
      if (this.view.visible) void this.refresh();
      return;
    }
    if (!root) return;
    const branch = (await head(this.repos.git(root))).branch;
    if (branch === this.branch) return;
    this.branch = branch;
    this.changed.fire(undefined);
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
    this.changes.clear();
    this.fetchedTargets.clear();
    const root = this.repos.currentRoot();
    this.root = root;
    const show = (message: string | undefined, needsAuth = false) => {
      if (generation !== this.generation) return;
      this.view.message = message;
      void vscode.commands.executeCommand("setContext", NEEDS_AUTH, needsAuth);
      this.changed.fire(undefined);
    };
    this.mrs = [];
    this.loaded = false;
    if (!root) return show("No Git repository is open.");
    const git = this.repos.git(root);
    const found = await findHosting(git);
    if (!("hosting" in found)) {
      this.hosting = undefined;
      return show(found.problem);
    }
    const h = (this.hosting = found.hosting);
    this.view.title = `${mergeRequestWord(h.provider)}s`;
    this.showDescription();
    try {
      const [mrs, current] = await Promise.all([openMergeRequests(this.api, h), head(git)]);
      if (generation !== this.generation) return;
      this.mrs = mrs;
      this.branch = current.branch;
      this.loaded = true;
      show(undefined);
    } catch (e) {
      if (e instanceof AuthRequired) return show(undefined, true);
      show(e instanceof Error ? e.message : String(e));
    }
  }

  /** For the integration tests: the view's message and its merge requests. */
  summary(): { message?: string; mergeRequests: string[] } {
    return {
      message: this.view.message,
      mergeRequests: this.mrs.map((m) => `${m.id} ${m.title}`),
    };
  }

  // ---- Changes of a merge request -------------------------------------------------------------

  private fetch(git: Git, remote: string, ref: string): Promise<void> {
    const run = this.fetchQueue.then(() => git.network(["fetch", remote, ref]));
    this.fetchQueue = run.catch(() => undefined);
    return run;
  }

  /** Fetches what is missing locally and lists the changed files (cached until a refresh). */
  changesOf(mr: MergeRequest): Promise<MergeRequestChanges> {
    let p = this.changes.get(mr.id);
    if (!p) {
      p = this.loadChanges(mr);
      this.changes.set(mr.id, p);
      p.catch(() => this.changes.delete(mr.id));
    }
    return p;
  }

  private async loadChanges(mr: MergeRequest): Promise<MergeRequestChanges> {
    const h = this.hosting;
    if (!h || !this.root) throw new Error("No repository.");
    const git = this.repos.git(this.root);
    const has = async (rev: string) =>
      !!(
        await git.run(["rev-parse", "-q", "--verify", `${rev}^{commit}`], { okCodes: [1] })
      ).trim();
    let headSha = mr.headSha;
    if (!headSha || !(await has(headSha))) {
      await this.fetch(git, h.remote, mergeRequestHeadRef(h.provider, mr.id));
      headSha ??= (await git.run(["rev-parse", "FETCH_HEAD"])).trim();
    }
    // The target moves: fetch it once per refresh (offline: use what is there).
    const target = `refs/remotes/${h.remote}/${mr.target}`;
    if (!this.fetchedTargets.has(mr.target)) {
      try {
        await this.fetch(git, h.remote, mr.target);
        this.fetchedTargets.add(mr.target);
      } catch (e) {
        if (!(await has(target))) throw e;
      }
    }
    const base = (await git.run(["merge-base", target, headSha])).trim();
    const files = parseNameStatus(
      await git.run(["diff-tree", "-r", "-z", "--name-status", "-M", base, headSha]),
    );
    return { base, head: headSha, files };
  }

  // ---- Tree data provider ---------------------------------------------------------------------

  async getChildren(node?: MrNode): Promise<MrNode[]> {
    if (!node) {
      if (!this.loaded) return [];
      const items = sortItems(this.mrs, this.sort.get()).map((mr): MrNode => ({ kind: "mr", mr }));
      return items.length
        ? items
        : [{ kind: "note", id: "none", text: `No open ${this.word().toLowerCase()}s` }];
    }
    if (node.kind !== "mr") return [];
    const id = `${node.mr.id}`;
    try {
      const c = await this.changesOf(node.mr);
      if (!c.files.length) return [{ kind: "note", id: `${id}:empty`, text: "No changes" }];
      return c.files.map((file) => ({
        kind: "file",
        mr: node.mr,
        file,
        base: c.base,
        head: c.head,
      }));
    } catch (e) {
      const text = e instanceof Error ? e.message.split("\n")[0] : String(e);
      return [
        {
          kind: "note",
          id: `${id}:error`,
          text: `Could not load the changes: ${text}`,
          error: true,
        },
      ];
    }
  }

  private word(): string {
    return mergeRequestWord(this.hosting?.provider ?? "gitlab");
  }

  getTreeItem(node: MrNode): vscode.TreeItem {
    switch (node.kind) {
      case "mr":
        return this.mrItem(node);
      case "file":
        return this.fileItem(node);
      case "note": {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.id = `note:${node.id}`;
        if (node.error) item.iconPath = new vscode.ThemeIcon("warning");
        item.tooltip = node.text;
        return item;
      }
    }
  }

  private mrItem(node: Extract<MrNode, { kind: "mr" }>): vscode.TreeItem {
    const m = node.mr;
    const provider = this.hosting?.provider ?? "gitlab";
    const ref = mergeRequestRef(provider, m.id);
    const current = !!this.branch && !m.fork && m.source === this.branch;
    const item = new vscode.TreeItem(m.title, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `mr:${m.id}`;
    item.description = [ref, m.authorName, current ? "current branch" : "", statusText(m)]
      .filter(Boolean)
      .join(" · ");
    item.iconPath = m.draft
      ? new vscode.ThemeIcon("git-pull-request-draft")
      : m.conflicts
        ? new vscode.ThemeIcon(
            "git-pull-request",
            new vscode.ThemeColor("gitDecoration.conflictingResourceForeground"),
          )
        : new vscode.ThemeIcon("git-pull-request");
    item.contextValue = m.fork ? "mr.fork" : "mr";
    const tip = new vscode.MarkdownString();
    tip.appendMarkdown(`**${ref}** `).appendText(m.title);
    tip.appendMarkdown("\n\n").appendText(`${m.source} → ${m.target}`);
    tip.appendMarkdown("\n\n").appendText(`By ${m.authorName}, opened ${when(m.createdAt)}`);
    tip.appendMarkdown("\n\n").appendText(`Updated ${when(m.updatedAt)}`);
    const extra = [
      statusText(m),
      m.labels.length ? `labels: ${m.labels.join(", ")}` : "",
      m.reviewers.length ? `reviewers: ${m.reviewers.join(", ")}` : "",
      m.comments ? `${m.comments} comments` : "",
    ].filter(Boolean);
    if (extra.length) tip.appendMarkdown("\n\n").appendText(extra.join(" · "));
    if (m.description.trim()) {
      const text = m.description.length > 1500 ? `${m.description.slice(0, 1500)}…` : m.description;
      tip.appendMarkdown(`\n\n---\n\n${text}`);
    }
    item.tooltip = tip;
    return item;
  }

  private fileItem(node: Extract<MrNode, { kind: "file" }>): vscode.TreeItem {
    const f = node.file;
    const slash = f.path.lastIndexOf("/");
    const item = new vscode.TreeItem(
      vscode.Uri.from({ scheme: STATUS_SCHEME, path: `/${f.path}`, query: f.status }),
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `file:${node.mr.id}:${f.path}`;
    item.label = f.path.slice(slash + 1);
    item.description = [f.oldPath ? `← ${f.oldPath}` : "", slash >= 0 ? f.path.slice(0, slash) : ""]
      .filter(Boolean)
      .join("  ");
    item.tooltip = `${f.oldPath ? `${f.oldPath} → ` : ""}${f.path}`;
    item.contextValue = "mrFile";
    item.command = { command: "gitTool.mr.diff", title: "Show Diff", arguments: [node] };
    return item;
  }

  /** Diff of a file from the merge base to the merge request's head. */
  async openDiff(node: unknown): Promise<void> {
    const n = node as MrNode | undefined;
    if (n?.kind !== "file" || !this.root) return;
    const f = n.file;
    const left = revisionUri(this.root, f.status === "A" ? "" : n.base, f.oldPath ?? f.path);
    const right = revisionUri(this.root, f.status === "D" ? "" : n.head, f.path);
    const ref = mergeRequestRef(this.hosting?.provider ?? "gitlab", n.mr.id);
    await vscode.commands.executeCommand(
      "vscode.diff",
      left,
      right,
      `${path.basename(f.path)} (${ref})`,
      { preview: true },
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
