// Commands: palette entries, editor/explorer menus, and the native context menus of the Log
// webview (`webview/context`, whose argument is the element's data-vscode-context object).
import * as path from "path";
import * as vscode from "vscode";
import type { Annotations } from "./annotate";
import {
  branchActions,
  checkout,
  deleteRef,
  merge,
  newBranchFrom,
  pushBranch,
  rebaseOnto,
  rename,
  showBranchesPopup,
} from "./branches";
import { copyText } from "./clipboard";
import type { CommitView } from "./commitView";
import { push, update } from "./git/operations";
import { head, lineHistory, refs } from "./git/queries";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";
import type { LogView } from "./logView";
import { openCommitDiff, revisionUri, shortHash } from "./revisions";
import { newTag } from "./tags";

interface CommitContext {
  hash: string;
  parents: string[];
}
interface RefContext {
  refName: string;
  refKind: "head" | "remote" | "tag";
}
interface CommitFileContext {
  hash: string;
  parent?: string;
  path: string;
  oldPath?: string;
}

export type Register = (id: string, fn: (...args: never[]) => unknown) => void;

export function registerCommands(
  reg: Register,
  repos: Repos,
  log: LogView,
  commitView: CommitView,
  annotations: Annotations,
): void {
  /** Runs `fn` with the current repository, then refreshes the views. */
  const withGit =
    <A extends unknown[]>(fn: (git: Git, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const git = repos.currentGit();
      if (!git) return;
      await fn(git, ...args);
      repos.fire(git.root);
    };

  // ---- Palette / menus ------------------------------------------------------------------------

  reg("gitTool.showLog", () => log.show({}));
  reg("gitTool.refresh", () => {
    repos.fire(undefined);
    void log.sendRefs(true);
  });
  // A hash (click in the Compare view) or a commit node (its context menu).
  reg("gitTool.showCommitInLog", (arg: string | { hash?: string }) => {
    const hash = typeof arg === "string" ? arg : arg?.hash;
    if (hash) return log.show(undefined, hash);
  });
  reg("gitTool.showFileHistory", async (uri?: vscode.Uri) => {
    const file = uri ?? vscode.window.activeTextEditor?.document.uri;
    const target = file && repos.forFile(file);
    if (!target) return;
    repos.setCurrent(target.git.root);
    await log.show({ path: target.rel });
  });
  reg("gitTool.showSelectionHistory", async () => {
    const editor = vscode.window.activeTextEditor;
    const target = editor && repos.forFile(editor.document.uri);
    if (!editor || !target) return;
    const sel = editor.selection;
    const start = sel.start.line + 1;
    const end = Math.max(start, sel.end.character || sel.isEmpty ? sel.end.line + 1 : sel.end.line);
    if (editor.document.isDirty) await editor.document.save();
    let hashes: string[] = [];
    const ok = await withProgress("History for selection", async () => {
      hashes = await lineHistory(target.git, target.rel, start, end);
    });
    if (!ok) return;
    repos.setCurrent(target.git.root);
    await log.show({ hashes, label: `${target.rel}:${start}-${end}` });
  });
  reg("gitTool.annotate", (uri?: vscode.Uri) => {
    const editor = vscode.window.activeTextEditor;
    if (uri instanceof vscode.Uri && editor?.document.uri.toString() !== uri.toString()) return;
    return annotations.toggle(editor);
  });
  reg("gitTool.closeAnnotations", () => annotations.toggle());
  reg("gitTool.commit", () => commitView.focus());
  reg(
    "gitTool.branches",
    withGit((git) =>
      showBranchesPopup(git, log, [
        { label: "$(arrow-down) Pull…", command: "gitTool.update" },
        { label: "$(check) Commit…", command: "gitTool.commit" },
        { label: "$(arrow-up) Push…", command: "gitTool.push" },
      ]),
    ),
  );
  reg(
    "gitTool.fetch",
    withGit((git) => withProgress("Fetch", () => git.network(["fetch", "--all", "--prune"]))),
  );
  reg(
    "gitTool.update",
    withGit((git) => {
      const method = vscode.workspace
        .getConfiguration("gitTool")
        .get<string>("updateMethod", "merge");
      return withProgress("Pull", () => update(git, method === "rebase" ? "rebase" : "merge"));
    }),
  );
  reg(
    "gitTool.push",
    withGit(async (git) => {
      const h = await head(git);
      const branch = (await refs(git)).find((r) => r.kind === "head" && r.name === h.branch);
      const target = branch?.upstream ?? "a new upstream branch";
      const count = branch?.upstream ? `${branch.ahead ?? 0} commit(s)` : "the branch";
      const choice = await vscode.window.showInformationMessage(
        `Push ${count} of ${h.branch ?? "HEAD"} to ${target}?`,
        { modal: true },
        "Push",
        "Force Push",
      );
      if (choice) await withProgress("Push", () => push(git, choice === "Force Push"));
    }),
  );

  // ---- Log: commit rows -----------------------------------------------------------------------

  reg("gitTool.log.copyHash", async (c: CommitContext) => {
    await copyText(c.hash);
    vscode.window.setStatusBarMessage(`$(copy) Copied ${shortHash(c.hash)}`, 3000);
  });
  reg(
    "gitTool.log.checkout",
    withGit((git, c: CommitContext) =>
      withProgress(`Checkout ${shortHash(c.hash)}`, () =>
        git.write(["switch", "--detach", c.hash]),
      ),
    ),
  );
  reg(
    "gitTool.log.newBranch",
    withGit((git, c: CommitContext) => newBranchFrom(git, c.hash, shortHash(c.hash))),
  );
  reg(
    "gitTool.log.newTag",
    withGit((git, c: CommitContext) => newTag(git, c.hash, shortHash(c.hash))),
  );
  const mainline = (c: CommitContext) => (c.parents.length > 1 ? ["-m", "1"] : []);
  reg(
    "gitTool.log.cherryPick",
    withGit((git, c: CommitContext) =>
      withProgress(`Cherry-pick ${shortHash(c.hash)}`, () =>
        git.write(["cherry-pick", ...mainline(c), c.hash]),
      ),
    ),
  );
  reg(
    "gitTool.log.revert",
    withGit((git, c: CommitContext) =>
      withProgress(`Revert ${shortHash(c.hash)}`, () =>
        git.write(["revert", "--no-edit", ...mainline(c), c.hash]),
      ),
    ),
  );
  reg(
    "gitTool.log.reset",
    withGit(async (git, c: CommitContext) => {
      const h = await head(git);
      const modes = [
        { label: "Soft", detail: "Keep the changes, staged", mode: "--soft" },
        { label: "Mixed", detail: "Keep the changes, unstaged (default)", mode: "--mixed" },
        { label: "Hard", detail: "Discard all changes in the working tree", mode: "--hard" },
        { label: "Keep", detail: "Drop the commits' changes, keep local ones", mode: "--keep" },
      ];
      const picked = await vscode.window.showQuickPick(modes, {
        title: `Reset ${h.branch ?? "HEAD"} to ${shortHash(c.hash)}`,
      });
      if (!picked) return;
      if (picked.mode === "--hard") {
        const ok = await vscode.window.showWarningMessage(
          `Hard reset ${h.branch ?? "HEAD"} to ${shortHash(c.hash)}?`,
          { modal: true, detail: "Uncommitted changes will be lost." },
          "Reset",
        );
        if (!ok) return;
      }
      await withProgress("Reset", () => git.write(["reset", picked.mode, c.hash]));
    }),
  );
  reg(
    "gitTool.log.undoCommit",
    withGit(async (git, c: CommitContext) => {
      const parent = c.parents[0];
      if (!parent) {
        void vscode.window.showWarningMessage("The first commit of a repository cannot be undone.");
        return;
      }
      await withProgress("Undo commit", () => git.write(["reset", "--soft", parent]));
    }),
  );
  reg("gitTool.log.rebaseInteractive", (c: CommitContext) => {
    const git = repos.currentGit();
    if (!git) return;
    const terminal = vscode.window.createTerminal({ name: "Interactive rebase", cwd: git.root });
    terminal.show();
    terminal.sendText(`git rebase -i ${c.parents[0] ?? "--root"}`);
  });

  // ---- Log: branches and tags -----------------------------------------------------------------

  const asRef = (r: RefContext) => ({ name: r.refName, kind: r.refKind });
  reg(
    "gitTool.ref.checkout",
    withGit((git, r: RefContext) => checkout(git, asRef(r))),
  );
  reg(
    "gitTool.ref.newBranch",
    withGit((git, r: RefContext) => newBranchFrom(git, r.refName)),
  );
  reg(
    "gitTool.ref.compare",
    withGit(async (git, r: RefContext) => {
      const current = (await head(git)).branch ?? "HEAD";
      await vscode.commands.executeCommand("gitTool.compareBranches", current, r.refName);
    }),
  );
  reg(
    "gitTool.ref.merge",
    withGit(async (git, r: RefContext) => merge(git, r.refName, (await head(git)).branch)),
  );
  reg(
    "gitTool.ref.rebase",
    withGit(async (git, r: RefContext) => rebaseOnto(git, r.refName, (await head(git)).branch)),
  );
  reg(
    "gitTool.ref.push",
    withGit(async (git, r: RefContext) => {
      const ref = (await refs(git)).find((x) => x.kind === "head" && x.name === r.refName);
      await pushBranch(git, r.refName, ref?.upstream);
    }),
  );
  reg(
    "gitTool.ref.rename",
    withGit((git, r: RefContext) => rename(git, r.refName)),
  );
  reg(
    "gitTool.ref.delete",
    withGit((git, r: RefContext) => deleteRef(git, asRef(r))),
  );
  reg(
    "gitTool.ref.actions",
    withGit(async (git, r: RefContext) => {
      const [h, all] = await Promise.all([head(git), refs(git)]);
      const ref = all.find((x) => x.kind === r.refKind && x.name === r.refName);
      if (!ref) return;
      const action = await vscode.window.showQuickPick(branchActions(git, ref, h.branch, log), {
        title: ref.name,
      });
      await action?.run?.();
    }),
  );

  // ---- Log: files of a commit -----------------------------------------------------------------

  const root = () => repos.currentRoot();
  reg("gitTool.commitFile.diff", (f: CommitFileContext) => {
    const r = root();
    if (r) return openCommitDiff(r, f.hash, f.parent, f.path, f.oldPath);
  });
  reg("gitTool.commitFile.compareWithLocal", (f: CommitFileContext) => {
    const r = root();
    if (!r) return;
    return vscode.commands.executeCommand(
      "vscode.diff",
      revisionUri(r, f.hash, f.path),
      vscode.Uri.file(path.join(r, f.path)),
      `${path.basename(f.path)} (${shortHash(f.hash)} ↔ local)`,
    );
  });
  reg("gitTool.commitFile.openRevision", async (f: CommitFileContext) => {
    const r = root();
    if (!r) return;
    const doc = await vscode.workspace.openTextDocument(revisionUri(r, f.hash, f.path));
    await vscode.window.showTextDocument(doc, { preview: true });
  });
  reg("gitTool.commitFile.open", (f: CommitFileContext) => {
    const r = root();
    if (r)
      return vscode.commands.executeCommand("vscode.open", vscode.Uri.file(path.join(r, f.path)));
  });
  reg("gitTool.commitFile.history", (f: CommitFileContext) => log.show({ path: f.path }));
}
