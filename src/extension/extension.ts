import * as vscode from "vscode";
import { Annotations } from "./annotate";
import { Changelists } from "./changelists";
import { registerCommands, type Register } from "./commands";
import { registerBranchCommands } from "./branchCommands";
import { captureBrowser, registerBrowserCommands } from "./browserCommands";
import { BranchesTree } from "./branchesTree";
import { Changes } from "./changes";
import { registerCommitCommands } from "./commitCommands";
import { COMMIT_VIEW_ID, CommitView } from "./commitView";
import { CompareView } from "./compareView";
import { head } from "./git/queries";
import { Repos } from "./git/repos";
import { HostingApi } from "./hosting";
import { registerIssueCommands } from "./issueCommands";
import { IssuesTree } from "./issuesTree";
import { registerMergeRequestCommands } from "./mergeRequestCommands";
import { MergeRequestsTree } from "./mergeRequestsTree";
import { LOG_VIEW_ID, LogView } from "./logView";
import { RevisionProvider, SCHEME } from "./revisions";
import { registerSelectionCommands } from "./selectionCommands";
import { registerOperationCommands } from "./operationCommands";
import { setHost } from "./git/output";
import { registerWorktreeCommands } from "./worktreeCommands";
import { WorktreesTree } from "./worktreesTree";

/** Returned by activate() for the integration tests. */
export interface TestApi {
  isAnnotated(uri: vscode.Uri): boolean;
  /** Paths ticked in the Changes view (refreshed first). */
  includedChanges(): Promise<string[]>;
  /** Refs listed in the Branches view (refreshed first), as `kind:name`. */
  branchNames(): Promise<string[]>;
  /** Result shown in the Compare view. */
  comparison(): { onlyLeft: string[]; onlyRight: string[]; files: string[] } | undefined;
  /** True while git commands run (the activity-bar icon shows the turning arrows). */
  isBusy(): boolean;
  /** Unfinished operation and conflict count shown by the Changes view (refreshed first). */
  changesInfo(): Promise<{ operation?: string; conflicts: number }>;
  /** Records the URLs the "Open in Browser" commands open, instead of opening them. */
  captureBrowser(): string[];
  /** Message and items of the Merge Requests view (reloaded first). */
  mergeRequests(): Promise<{ message?: string; mergeRequests: string[] }>;
  /** Message and items of the Issues view (reloaded first). */
  issues(): Promise<{ message?: string; issues: string[] }>;
  /** Files and notice the Commit view's list last drew (from the webview itself). */
  commitViewStatus(): { files: string[]; notice?: string } | undefined;
  /** Worktrees listed in the Worktrees view (refreshed first), as `folder:head[:current]`. */
  worktrees(): Promise<string[]>;
  /** Change count on the Git Tool activity-bar icon (changes refreshed first). */
  changeCountBadge(): Promise<{ value: number; tooltip: string } | undefined>;
}

export async function activate(context: vscode.ExtensionContext): Promise<TestApi> {
  const repos = new Repos();
  context.subscriptions.push(repos);
  await repos.init();

  const log = new LogView(context.extensionUri, repos);
  const changes = new Changes(
    repos,
    new Changelists(context.workspaceState),
    context.workspaceState,
  );
  const commitView = new CommitView(context.extensionUri, repos, changes);
  const branches = new BranchesTree(repos);
  const compare = new CompareView(repos);
  const worktrees = new WorktreesTree(repos);
  const annotations = new Annotations(repos);
  const hostingApi = new HostingApi(context.secrets);
  const mergeRequests = new MergeRequestsTree(repos, hostingApi, context.globalState);
  const issues = new IssuesTree(repos, hostingApi, context.globalState);
  context.subscriptions.push(
    hostingApi,
    mergeRequests,
    issues,
    log,
    changes,
    commitView,
    branches,
    compare,
    worktrees,
    annotations,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, new RevisionProvider(repos)),
    vscode.window.registerWebviewViewProvider(LOG_VIEW_ID, log, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.registerWebviewViewProvider(COMMIT_VIEW_ID, commitView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  const reg: Register = (id, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  registerCommands(reg, repos, log, commitView, annotations);
  registerCommitCommands(reg, repos, changes);
  registerBranchCommands(reg, repos, log, branches, compare);
  registerSelectionCommands(reg, repos, log);
  registerOperationCommands(reg, repos);
  registerBrowserCommands(reg, repos, hostingApi);
  registerMergeRequestCommands(reg, repos, hostingApi, mergeRequests, compare);
  registerIssueCommands(reg, repos, issues);
  registerWorktreeCommands(reg, repos, log, worktrees);
  setHost({
    refresh: () => repos.fire(undefined),
    currentGit: () => {
      const root = repos.currentRoot();
      return root ? repos.git(root) : undefined;
    },
    reportDir: context.globalStorageUri.fsPath,
  });
  void changes.refresh();
  void branches.refresh();
  void worktrees.refresh();

  context.subscriptions.push(branchStatusItem(repos), changeCountBadge(changes, branches.view));
  return {
    isAnnotated: (uri) =>
      annotations.isActive(
        vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === uri.toString()),
      ),
    includedChanges: async () => {
      await changes.refresh();
      return changes.includedPaths();
    },
    branchNames: async () => {
      await branches.refresh(true);
      return branches.names();
    },
    comparison: () => compare.summary(),
    isBusy: () => repos.busy.busy,
    changesInfo: async () => {
      await changes.refresh();
      return { operation: changes.operation, conflicts: changes.conflicts };
    },
    captureBrowser,
    mergeRequests: async () => {
      await mergeRequests.refresh();
      return mergeRequests.summary();
    },
    issues: async () => {
      await issues.refresh();
      return issues.summary();
    },
    commitViewStatus: () => commitView.drawn,
    worktrees: async () => {
      await worktrees.refresh(true);
      return worktrees.summary();
    },
    changeCountBadge: async () => {
      await changes.refresh();
      const badge = branches.view.badge;
      return badge && { value: badge.value, tooltip: badge.tooltip };
    },
  };
}

/**
 * The number of changed files on the Git Tool activity-bar icon. It goes on the Branches tree
 * view, not on the Commit view the count belongs to: VS Code keeps a webview view's badge on its
 * on-screen pane, which only exists once the view has been shown, so after a window reload the
 * icon had no count until the Git Tool was opened. A tree view's badge exists from activation.
 * VS Code adds up the number badges of all views in a container, so exactly one view carries it.
 */
function changeCountBadge(changes: Changes, view: vscode.TreeView<unknown>): vscode.Disposable {
  return changes.onDidChangeState(() => {
    const n = changes.total;
    view.badge = n ? { value: n, tooltip: `${n} change${n === 1 ? "" : "s"}` } : undefined;
  });
}

/** PyCharm's branch widget: the current branch on the right of the status bar. */
function branchStatusItem(repos: Repos): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "gitTool.branch",
    vscode.StatusBarAlignment.Right,
    1000,
  );
  item.name = "Git Tool: Branches";
  item.command = "gitTool.branches";
  const update = async () => {
    const enabled = vscode.workspace.getConfiguration("gitTool").get("showBranchInStatusBar", true);
    const root = repos.currentRoot();
    if (!enabled || !root) return item.hide();
    try {
      const h = await head(repos.git(root));
      item.text = `$(git-branch) ${h.branch ?? h.hash?.slice(0, 8) ?? "no commits"}`;
      item.tooltip = `Branches of ${root}`;
      item.show();
    } catch {
      item.hide();
    }
  };
  void update();
  const subs = [
    repos.onDidChange(() => void update()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("gitTool.showBranchInStatusBar")) void update();
    }),
  ];
  return vscode.Disposable.from(item, ...subs);
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
