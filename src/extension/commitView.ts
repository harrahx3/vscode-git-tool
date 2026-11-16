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
      repoName: c.root ? path.basename(c.root) : undefined,
      branch: c.branch,
      included: c.includedPaths().length,
      total: c.total,
      lastMessage: c.lastMessage,
      ahead: c.ahead,
      lists: c.lists(),
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
        await this.changes.include(m.paths, m.on);
        break;
      case "selection":
        this.changes.setSelection(m.keys);
        break;
      case "move":
        await this.changes.move(m.paths, m.list);
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
    const root = this.changes.root;
    if (!root) return;
    const paths = this.changes.includedPaths();
    const git = this.repos.git(root);
    this.post({ type: "busy", busy: true, label: "Committing…" });
    // Status again: the list may be a few hundred milliseconds behind the disk. The follow-up
    // is part of the task, so a retry from an error notification (hook fixed…) also does it.
    const ok = await withProgress(amend ? "Amend commit" : "Commit", async () => {
      const hookOutput = await commitFiles(git, await status(git), paths, message, amend);
      await this.committed(paths.length, hookOutput);
    });
    if (ok && andPush) {
      this.post({ type: "busy", busy: true, label: "Pushing…" });
      await withProgress("Push", () => push(git));
    }
    this.post({ type: "busy", busy: false });
    this.repos.fire(root);
    await this.changes.refresh();
  }

  private async committed(count: number, hookOutput: string): Promise<void> {
    clearHookProblems();
    this.post({ type: "committed" });
    await this.changes.resetChoices();
    // What a pre-commit hook printed while letting the commit through ("pre-commit: 5 passed").
    const summary = hookOutput.trim() ? hookSummary(hookOutput) : undefined;
    vscode.window.setStatusBarMessage(
      `$(check) Committed ${count} file${count === 1 ? "" : "s"}${summary ? ` · ${summary}` : ""}`,
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
