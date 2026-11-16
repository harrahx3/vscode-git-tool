// The Log tab of the Git tool window (bottom panel): branches, commit graph, commit details.
import * as path from "path";
import * as vscode from "vscode";
import { LOG_TOOLBAR_COMMANDS, type LogFromWebview, type LogToWebview } from "../shared/messages";
import type { LogFilter } from "../shared/types";
import { details, filterKeepsGraph, head, log, refs } from "./git/queries";
import type { Repos } from "./git/repos";
import { webviewHtml } from "./html";
import { openCommitDiff } from "./revisions";

export const LOG_VIEW_ID = "gitTool.log";

export class LogView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  private queue: LogToWebview[] = [];
  private fingerprint = "";
  /** Commits selected in the table, newest first (see the "selection" message). */
  private selection: string[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repos: Repos,
  ) {
    this.disposables.push(repos.onDidChange(() => void this.sendRefs(false)));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = webviewHtml(view.webview, this.extensionUri, "log", "Git Log");
    view.webview.onDidReceiveMessage((m: LogFromWebview) => this.onMessage(m));
    view.onDidDispose(() => {
      this.view = undefined;
      this.selection = [];
      this.ready = false;
    });
  }

  private post(message: LogToWebview): void {
    if (this.view && this.ready) void this.view.webview.postMessage(message);
    else this.queue.push(message);
  }

  private async onMessage(m: LogFromWebview): Promise<void> {
    const root = this.repos.currentRoot();
    try {
      switch (m.type) {
        case "ready": {
          this.ready = true;
          this.fingerprint = "";
          await this.sendRefs(true);
          const queued = this.queue;
          this.queue = [];
          for (const q of queued) this.post(q);
          break;
        }
        case "refresh":
          await this.sendRefs(true);
          break;
        case "selection":
          this.selection = m.hashes;
          break;
        case "selectRepo":
          this.repos.setCurrent(m.root);
          break;
        case "query": {
          if (!root)
            return this.post({
              type: "commits",
              requestId: m.requestId,
              commits: [],
              graph: false,
              hasMore: false,
            });
          const result = await log(this.repos.git(root), m.filter, m.limit);
          this.post({
            type: "commits",
            requestId: m.requestId,
            commits: result.commits,
            graph: filterKeepsGraph(m.filter),
            hasMore: result.hasMore,
          });
          break;
        }
        case "details":
          if (root)
            this.post({ type: "details", details: await details(this.repos.git(root), m.hash) });
          break;
        case "openDiff":
          if (root) await openCommitDiff(root, m.hash, m.parent, m.path, m.oldPath);
          break;
        case "command":
          if (LOG_TOOLBAR_COMMANDS.includes(m.command))
            await vscode.commands.executeCommand(m.command);
          break;
      }
    } catch (e) {
      this.post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Sends the repository list and refs; `force` also when nothing changed (the log re-queries). */
  async sendRefs(force: boolean): Promise<void> {
    if (!this.view || !this.ready) return;
    const roots = this.repos.roots();
    const root = this.repos.currentRoot();
    const repoList = roots.map((r) => ({ root: r, name: path.basename(r) }));
    if (!root) {
      this.post({ type: "repos", repos: repoList, current: undefined });
      this.post({ type: "refs", head: {}, refs: [] });
      return;
    }
    const git = this.repos.git(root);
    const [h, r] = await Promise.all([head(git), refs(git)]);
    const fingerprint = JSON.stringify([root, roots, h, r]);
    if (!force && fingerprint === this.fingerprint) return;
    this.fingerprint = fingerprint;
    this.post({ type: "repos", repos: repoList, current: root });
    this.post({ type: "refs", head: h, refs: r });
  }

  /** Commits selected in the table, newest first. */
  selectedCommits(): string[] {
    return this.selection;
  }

  /** Opens the Log tab with a filter, optionally selecting a commit. */
  async show(filter?: LogFilter, select?: string): Promise<void> {
    await vscode.commands.executeCommand(`${LOG_VIEW_ID}.focus`);
    if (filter) this.post({ type: "setFilter", filter, select });
    else if (select) this.post({ type: "select", hash: select });
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
