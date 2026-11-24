// The Commit view: message box, Amend, Commit / Commit and Push, and right under them the changed
// files grouped by changelist, with checkboxes choosing what gets committed (see changes.ts).
import * as path from "path";
import * as vscode from "vscode";
import {
  COMMIT_ROW_COMMANDS,
  type CommitFromWebview,
  type CommitToWebview,
  type CommitViewState,
} from "../shared/messages";
import type { Changes } from "./changes";
import { clearHookProblems } from "./git/hookReport";
import { hookSummary } from "./git/hooks";
import { commitFiles, push } from "./git/operations";
import { status } from "./git/queries";
import type { Repos } from "./git/repos";
import { withProgress } from "./git/ui";
import { webviewHtml } from "./html";

export const COMMIT_VIEW_ID = "gitTool.commit";

export class CommitView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private ready = false;
  /** What the webview last drew (integration tests). */
  drawn?: { files: string[]; notice?: string };
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly repos: Repos,
    private readonly changes: Changes,
  ) {
    this.disposables.push(changes.onDidChangeState(() => this.postState()));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };
    view.webview.html = webviewHtml(view.webview, this.extensionUri, "commit", "Commit");
    view.webview.onDidReceiveMessage((m: CommitFromWebview) => void this.onMessage(m));
    view.onDidDispose(() => {
      this.view = undefined;
      this.ready = false;
    });
    void this.changes.refresh();
  }

  private post(message: CommitToWebview): void {
    if (this.view && this.ready) void this.view.webview.postMessage(message);
  }

  private postState(): void {
    const c = this.changes;
    // The change count on the activity-bar icon is set in extension.ts, not here.
    if (this.view) this.view.description = c.where() || undefined;
    const state: CommitViewState = {
      repoName: c.root && !c.multi ? path.basename(c.root) : undefined,
      branch: c.multi ? undefined : c.branch,
      included: c.includedCount,
      total: c.total,
      lastMessage: c.lastMessage,
      ahead: c.ahead,
      lists: c.lists(),
      repos: c.headers(),
      notice: c.notice(),
    };
    this.post({ type: "state", state });
  }

  private async onMessage(m: CommitFromWebview): Promise<void> {
    switch (m.type) {
      case "ready":
        this.ready = true;
        this.postState();
        break;
      case "commit":
        await this.commit(m.message, m.amend, m.push);
        break;
      case "include":
        await this.changes.include(m.files, m.on);
        break;
      case "selection":
        this.changes.setSelection(m.keys);
        break;
      case "move":
        await this.changes.move(m.root, m.paths, m.list);
        break;
      case "status":
        this.drawn = { files: m.files, notice: m.notice };
        break;
      case "run":
        if ((COMMIT_ROW_COMMANDS as readonly string[]).includes(m.command))
          await vscode.commands.executeCommand(m.command, m.target);
        break;
    }
  }

  private async commit(message: string, amend: boolean, andPush: boolean): Promise<void> {
    // Each repository with ticked files gets a commit with this message. An amend (which may
    // have no ticked file) rewrites one commit: the repository with ticks, else the current one.
    let batches = this.changes.includedByRoot();
    if (amend && batches.length > 1) {
      this.post({
        type: "error",
        message: "Amend works on one repository: untick the files of the others.",
      });
      return;
    }
    const current = this.changes.root;
    if (!batches.length && amend && current) batches = [{ root: current, paths: [] }];
    if (!batches.length) return;
    this.post({ type: "busy", busy: true, label: "Committing…" });
    const committed: string[] = [];
    let failed = false;
    for (const { root, paths } of batches) {
      const git = this.repos.git(root);
      // Status again: the list may be a few hundred milliseconds behind the disk. The follow-up
      // is part of the task, so a retry from an error notification (hook fixed…) also does it.
      const ok = await withProgress(amend ? "Amend commit" : "Commit", async () => {
        const hookOutput = await commitFiles(git, await status(git), paths, message, amend);
        await this.committed(root, paths.length, hookOutput, batches.length === 1);
      });
      if (!ok) {
        failed = true;
        break;
      }
      committed.push(root);
    }
    // The message box is cleared once, when every repository is done.
    if (!failed) this.post({ type: "committed" });
    if (andPush) {
      for (const root of committed) {
        this.post({ type: "busy", busy: true, label: "Pushing…" });
        if (!(await withProgress("Push", () => push(this.repos.git(root))))) break;
      }
    }
    this.post({ type: "busy", busy: false });
    for (const root of committed) this.repos.fire(root);
    await this.changes.refresh();
  }

  private async committed(
    root: string,
    count: number,
    hookOutput: string,
    announce: boolean,
  ): Promise<void> {
    clearHookProblems();
    await this.changes.resetChoices(root);
    // What a pre-commit hook printed while letting the commit through ("pre-commit: 5 passed").
    const summary = hookOutput.trim() ? hookSummary(hookOutput) : undefined;
    const where = announce ? "" : ` in ${path.basename(root)}`;
    vscode.window.setStatusBarMessage(
      `$(check) Committed ${count} file${count === 1 ? "" : "s"}${where}${summary ? ` · ${summary}` : ""}`,
      6000,
    );
  }

  /** Focuses the message box (Commit command, Ctrl+K in PyCharm). */
  async focus(): Promise<void> {
    await vscode.commands.executeCommand(`${COMMIT_VIEW_ID}.focus`);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
