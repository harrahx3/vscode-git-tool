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

/** `root`: the repository of the node, for commands run on it (see `reg` in extension.ts). */
export type MrNode =
  | { kind: "repo"; root: string; name: string }
  | { kind: "mr"; root: string; mr: MergeRequest }
  | { kind: "file"; root: string; mr: MergeRequest; file: ChangedFile; base: string; head: string }
  | { kind: "note"; root: string; id: string; text: string; error?: boolean; signIn?: boolean };

/** What one repository's remote returned. */
interface RepoMrs {
  hosting?: Hosting;
  mrs: MergeRequest[];
  branch?: string;
  /** The list was loaded (else a message or the sign-in buttons are shown). */
  loaded: boolean;
  message?: string;
  needsAuth?: boolean;
}

const when = (iso: string) => (iso ? new Date(iso).toLocaleString() : "");

export class MergeRequestsTree implements vscode.TreeDataProvider<MrNode>, vscode.Disposable {
  readonly view: vscode.TreeView<MrNode>;
  hosting?: Hosting;
  private scopeKey?: string;
  private shown: string[] = [];
  private states = new Map<string, RepoMrs>();
  private readonly sort: SortSetting;
  /** The list needs reloading next time the view is shown. */
  private stale = true;
  private generation = 0;
  private readonly changes = new Map<string, Promise<MergeRequestChanges>>();
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
    if (this.repos.scopeKey() !== this.scopeKey) {
      this.stale = true;
      if (this.view.visible) void this.refresh();
      return;
    }
    let moved = false;
    await Promise.all(
      this.shown.map(async (root) => {
        const state = this.states.get(root);
        if (!state?.loaded) return;
        const branch = (await head(this.repos.git(root))).branch;
        if (branch === state.branch) return;
        state.branch = branch;
        moved = true;
      }),
    );
    if (moved) this.changed.fire(undefined);
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
    this.changes.clear();
    this.fetchedTargets.clear();
    const shown = this.repos.scopedRoots();
    this.scopeKey = this.repos.scopeKey();
    const states = new Map<string, RepoMrs>();
    await Promise.all(shown.map(async (root) => states.set(root, await this.load(root))));
    if (generation !== this.generation) return;
    this.shown = shown;
    this.states = states;
    // One repository: its message and sign-in buttons go on the view itself.
    const only = shown.length === 1 ? states.get(shown[0]) : undefined;
    this.hosting = only?.hosting;
    this.view.title = `${mergeRequestWord(only?.hosting?.provider ?? providerOf(states))}s`;
    this.view.message = shown.length ? only?.message : "No Git repository is open.";
    void vscode.commands.executeCommand("setContext", NEEDS_AUTH, !!only?.needsAuth);
    this.showDescription();
    this.changed.fire(undefined);
  }

  private async load(root: string): Promise<RepoMrs> {
    const git = this.repos.git(root);
    const found = await findHosting(git);
    if (!("hosting" in found)) return { mrs: [], loaded: false, message: found.problem };
    const hosting = found.hosting;
    try {
      const [mrs, current] = await Promise.all([openMergeRequests(this.api, hosting), head(git)]);
      return { hosting, mrs, branch: current.branch, loaded: true };
    } catch (e) {
      if (e instanceof AuthRequired) return { hosting, mrs: [], loaded: false, needsAuth: true };
      return {
        hosting,
        mrs: [],
        loaded: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** For the integration tests: the view's message and its merge requests. */
  summary(): { message?: string; mergeRequests: string[] } {
    return {
      message: this.view.message,
      mergeRequests: [...this.states.values()].flatMap((s) =>
        s.mrs.map((m) => `${m.id} ${m.title}`),
      ),
    };
  }

  // ---- Changes of a merge request -------------------------------------------------------------

  private fetch(git: Git, remote: string, ref: string): Promise<void> {
    const run = this.fetchQueue.then(() => git.network(["fetch", remote, ref]));
    this.fetchQueue = run.catch(() => undefined);
    return run;
  }

  /** Fetches what is missing locally and lists the changed files (cached until a refresh). */
  changesOf(root: string, mr: MergeRequest): Promise<MergeRequestChanges> {
    const key = `${root}\n${mr.id}`;
    let p = this.changes.get(key);
    if (!p) {
      p = this.loadChanges(root, mr);
      this.changes.set(key, p);
      p.catch(() => this.changes.delete(key));
    }
    return p;
  }

  private async loadChanges(root: string, mr: MergeRequest): Promise<MergeRequestChanges> {
    const h = this.states.get(root)?.hosting;
    if (!h) throw new Error("No repository.");
    const git = this.repos.git(root);
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
    const targetKey = `${root}\n${mr.target}`;
    if (!this.fetchedTargets.has(targetKey)) {
      try {
        await this.fetch(git, h.remote, mr.target);
        this.fetchedTargets.add(targetKey);
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
      if (this.shown.length > 1)
        return this.shown.map((root) => ({ kind: "repo", root, name: path.basename(root) }));
      return this.repoChildren(this.shown[0]);
    }
    if (node.kind === "repo") return this.repoChildren(node.root);
    if (node.kind !== "mr") return [];
    const { root } = node;
    const id = `${node.mr.id}`;
    try {
      const c = await this.changesOf(root, node.mr);
      if (!c.files.length) return [{ kind: "note", root, id: `${id}:empty`, text: "No changes" }];
      return c.files.map((file) => ({
        kind: "file",
        root,
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
          root,
          id: `${id}:error`,
          text: `Could not load the changes: ${text}`,
          error: true,
        },
      ];
    }
  }

  /** The repository's merge requests, or why there are none. */
  private repoChildren(root: string | undefined): MrNode[] {
    const state = root && this.states.get(root);
    if (!root || !state) return [];
    if (!state.loaded)
      return this.shown.length > 1 && (state.message || state.needsAuth)
        ? [
            {
              kind: "note",
              root,
              id: "unavailable",
              text: state.message ?? "Sign in to list the merge requests",
              signIn: state.needsAuth,
            },
          ]
        : [];
    const items = sortItems(state.mrs, this.sort.get()).map((mr): MrNode => ({
      kind: "mr",
      root,
      mr,
    }));
    return items.length
      ? items
      : [
          {
            kind: "note",
            root,
            id: "none",
            text: `No open ${mergeRequestWord(state.hosting?.provider ?? "gitlab").toLowerCase()}s`,
          },
        ];
  }

  private provider(root: string): Hosting["provider"] {
    return this.states.get(root)?.hosting?.provider ?? "gitlab";
  }

  getTreeItem(node: MrNode): vscode.TreeItem {
    switch (node.kind) {
      case "repo": {
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
        item.id = `repo:${node.root}`;
        item.description = this.states.get(node.root)?.hosting?.path;
        item.iconPath = new vscode.ThemeIcon("repo");
        item.tooltip = node.root;
        return item;
      }
      case "mr":
        return this.mrItem(node);
      case "file":
        return this.fileItem(node);
      case "note": {
        const item = new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
        item.id = `note:${node.root}:${node.id}`;
        if (node.signIn)
          item.command = {
            command: "gitTool.mergeRequests.signIn",
            title: "Sign In",
            arguments: [node],
          };
        if (node.error) item.iconPath = new vscode.ThemeIcon("warning");
        item.tooltip = node.text;
        return item;
      }
    }
  }

  private mrItem(node: Extract<MrNode, { kind: "mr" }>): vscode.TreeItem {
    const m = node.mr;
    const provider = this.provider(node.root);
    const branch = this.states.get(node.root)?.branch;
    const ref = mergeRequestRef(provider, m.id);
    const current = !!branch && !m.fork && m.source === branch;
    const item = new vscode.TreeItem(m.title, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `mr:${node.root}:${m.id}`;
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
    item.id = `file:${node.root}:${node.mr.id}:${f.path}`;
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
    if (n?.kind !== "file") return;
    const f = n.file;
    const left = revisionUri(n.root, f.status === "A" ? "" : n.base, f.oldPath ?? f.path);
    const right = revisionUri(n.root, f.status === "D" ? "" : n.head, f.path);
    const ref = mergeRequestRef(this.provider(n.root), n.mr.id);
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

/** Merge-request wording for a view listing several repositories: "Pull" only if all are GitHub. */
function providerOf(states: Map<string, RepoMrs>): Hosting["provider"] {
  const providers = [...states.values()].flatMap((s) => (s.hosting ? [s.hosting.provider] : []));
  return providers.length && providers.every((p) => p === "github") ? "github" : "gitlab";
}
