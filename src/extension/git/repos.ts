// Repository discovery and change events, borrowed from VS Code's built-in Git extension.
import * as path from "path";
import * as vscode from "vscode";
import { BusyTracker } from "./busy";
import { apiNetworkTask, type NetworkApi } from "./network";
import { Git } from "./runner";
import { outputChannel } from "./ui";

/** The part of the `vscode.git` extension API (version 1) used here. */
interface GitApiRepository {
  readonly rootUri: vscode.Uri;
  readonly state: { onDidChange: vscode.Event<void> };
  fetch: NetworkApi["fetch"];
  push: NetworkApi["push"];
}

interface GitApi {
  readonly git: { readonly path: string };
  readonly repositories: GitApiRepository[];
  readonly onDidOpenRepository: vscode.Event<GitApiRepository>;
  readonly onDidCloseRepository: vscode.Event<GitApiRepository>;
}
interface GitExtension {
  getAPI(version: 1): GitApi;
}

/**
 * Views that show progress while git runs: the Commit view puts the turning arrows on the
 * Git Tool activity-bar icon (VS Code does so for any view of a side-bar container) and a bar
 * at the top of the view; the Log gets the same bar in the panel.
 */
const PROGRESS_VIEWS = ["gitTool.commit", "gitTool.log"];

function showProgress(): () => void {
  let done!: () => void;
  const idle = new Promise<void>((resolve) => (done = resolve));
  for (const viewId of PROGRESS_VIEWS)
    void vscode.window.withProgress({ location: { viewId } }, () => idle);
  return done;
}

/**
 * Tracks the open repositories and which one the views show. Fires `onDidChange` (debounced)
 * when the repository list, the current repository or anything in it changes.
 */
export class Repos implements vscode.Disposable {
  private api?: GitApi;
  private current?: string;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly repoListeners = new Map<string, vscode.Disposable>();
  private readonly changed = new vscode.EventEmitter<{ root: string | undefined }>();
  private timer?: NodeJS.Timeout;
  private pendingRoot?: string | undefined;
  readonly onDidChange = this.changed.event;
  /** Running git commands: drives the progress shown in the views. */
  readonly busy = new BusyTracker(showProgress);

  async init(): Promise<void> {
    const ext = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!ext) throw new Error("VS Code's built-in Git extension is disabled.");
    const exports = ext.isActive ? ext.exports : await ext.activate();
    this.api = exports.getAPI(1);
    for (const repo of this.api.repositories) this.watch(repo);
    this.disposables.push(
      this.api.onDidOpenRepository((r) => {
        this.watch(r);
        this.fire(undefined);
      }),
      this.api.onDidCloseRepository((r) => {
        this.repoListeners.get(r.rootUri.fsPath)?.dispose();
        this.repoListeners.delete(r.rootUri.fsPath);
        if (this.current === r.rootUri.fsPath) this.current = undefined;
        this.fire(undefined);
      }),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        const root = e && this.rootOf(e.document.uri);
        if (root && root !== this.current && this.roots().length > 1) {
          this.current = root;
          this.fire(undefined);
        }
      }),
    );
  }

  private watch(repo: GitApiRepository): void {
    const root = repo.rootUri.fsPath;
    this.repoListeners.get(root)?.dispose();
    this.repoListeners.set(
      root,
      repo.state.onDidChange(() => this.fire(root)),
    );
  }

  /** Debounced change notification; `root` = the repository that changed, if only one did. */
  fire(root: string | undefined): void {
    this.pendingRoot = this.timer && this.pendingRoot !== root ? undefined : root;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.changed.fire({ root: this.pendingRoot });
    }, 300);
  }

  roots(): string[] {
    return (this.api?.repositories ?? [])
      .map((r) => r.rootUri.fsPath)
      .sort((a, b) => a.localeCompare(b));
  }

  /** Repository containing a file (the innermost one for nested repositories). */
  rootOf(uri: vscode.Uri): string | undefined {
    if (uri.scheme !== "file" && uri.scheme !== "vscode-remote") return undefined;
    const file = uri.fsPath;
    let best: string | undefined;
    for (const root of this.roots()) {
      if (
        (file === root || file.startsWith(root + path.sep)) &&
        (!best || root.length > best.length)
      )
        best = root;
    }
    return best;
  }

  /** Repository the views show: the chosen one, else the active editor's, else the first. */
  currentRoot(): string | undefined {
    const roots = this.roots();
    if (this.current && roots.includes(this.current)) return this.current;
    const editor = vscode.window.activeTextEditor;
    const fromEditor = editor && this.rootOf(editor.document.uri);
    this.current = fromEditor ?? roots[0];
    return this.current;
  }

  setCurrent(root: string): void {
    if (root === this.current) return;
    this.current = root;
    this.fire(undefined);
  }

  git(root: string): Git {
    return new Git(
      root,
      this.api?.git.path ?? "git",
      (line) => outputChannel().appendLine(line),
      (task) => this.busy.track(task),
      (args) => {
        const repo = this.api?.repositories.find((r) => r.rootUri.fsPath === root);
        return repo && apiNetworkTask(repo, args);
      },
    );
  }

  /** Git of the current repository; shows an error and returns undefined when there is none. */
  currentGit(): Git | undefined {
    const root = this.currentRoot();
    if (!root) {
      void vscode.window.showWarningMessage("No Git repository is open.");
      return undefined;
    }
    return this.git(root);
  }

  /** Git of the repository holding `uri`, with its repository-relative path. */
  forFile(uri: vscode.Uri): { git: Git; rel: string } | undefined {
    const root = this.rootOf(uri);
    if (!root) {
      void vscode.window.showWarningMessage(
        `${path.basename(uri.fsPath)} is not in a Git repository.`,
      );
      return undefined;
    }
    return { git: this.git(root), rel: path.relative(root, uri.fsPath).split(path.sep).join("/") };
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.busy.dispose();
    for (const d of this.repoListeners.values()) d.dispose();
    for (const d of this.disposables) d.dispose();
    this.changed.dispose();
  }
}
