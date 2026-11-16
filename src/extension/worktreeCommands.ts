// Commands of the Worktrees view, the Switch Worktree… quick pick and the Branches view's
// "Check Out in New Worktree…".
import * as path from "path";
import * as vscode from "vscode";
import type { Ref } from "../shared/types";
import { worktreeHeadLabel, type Worktree } from "../shared/worktrees";
import { pickRef } from "./branchCommands";
import { copyText } from "./clipboard";
import type { Register } from "./commands";
import type { Repos } from "./git/repos";
import type { LogView } from "./logView";
import {
  deleteWorktrees,
  listWorktrees,
  newWorktree,
  openWorktree,
  pruneWorktrees,
  samePath,
  type OpenMode,
} from "./worktrees";
import type { WorktreeNode, WorktreesTree } from "./worktreesTree";

interface RefArg {
  ref?: Ref;
  refName?: string;
  refKind?: Ref["kind"];
}

export function registerWorktreeCommands(
  reg: Register,
  repos: Repos,
  log: LogView,
  tree: WorktreesTree,
): void {
  const done = async (root: string) => {
    repos.fire(root);
    await tree.refresh(true);
  };

  /** The selection when it holds the clicked node, else the clicked node (or the selection). */
  const targets = (node?: WorktreeNode, selected?: WorktreeNode[]): WorktreeNode[] => {
    const sel = selected ?? [...tree.view.selection];
    if (!node) return sel;
    return sel.some((s) => s.worktree.path === node.worktree.path) ? sel : [node];
  };

  const open = (mode: OpenMode) => async (node?: WorktreeNode) => {
    const target = node ?? tree.view.selection[0];
    if (target) await openWorktree(repos, target.worktree, mode);
  };
  reg("gitTool.worktree.open", open("switch"));
  reg("gitTool.worktree.openNewWindow", open("newWindow"));
  reg("gitTool.worktree.addToWorkspace", open("addToWorkspace"));
  reg("gitTool.worktree.copyPath", async (node?: WorktreeNode) => {
    if (!node) return;
    await copyText(node.worktree.path);
    vscode.window.setStatusBarMessage(`$(copy) Copied ${node.worktree.path}`, 3000);
  });
  reg("gitTool.worktree.showInLog", (node?: WorktreeNode) => {
    if (node?.worktree.head) return log.show(undefined, node.worktree.head);
  });
  reg("gitTool.worktree.delete", async (node?: WorktreeNode, selected?: WorktreeNode[]) => {
    const git = repos.currentGit();
    if (!git) return;
    const list = targets(node, selected).map((n) => n.worktree);
    if (!list.length) return;
    await deleteWorktrees(git, list, repos.currentRoot());
    await done(git.root);
  });

  reg("gitTool.worktrees.new", async (arg?: RefArg) => {
    const git = repos.currentGit();
    if (!git) return;
    // From the Branches view (`ref`), from the Log's branch menu (`refName`/`refKind`), or picked.
    const fromArg: Ref | undefined =
      arg?.ref ??
      (arg?.refName && arg.refKind
        ? { name: arg.refName, kind: arg.refKind, hash: "" }
        : undefined);
    const target = fromArg ?? (await pickRef(git, "New Worktree: branch to check out"));
    if (!target) return;
    await newWorktree(repos, git, target);
    await done(git.root);
  });
  reg("gitTool.ref.newWorktree", (arg?: RefArg) =>
    vscode.commands.executeCommand("gitTool.worktrees.new", arg),
  );
  reg("gitTool.worktrees.prune", async () => {
    const git = repos.currentGit();
    if (!git) return;
    await pruneWorktrees(git);
    await done(git.root);
  });
  reg("gitTool.worktrees.refresh", () => tree.refresh(true));

  reg("gitTool.worktrees.switch", async () => {
    const git = repos.currentGit();
    if (!git) return;
    const root = git.root;
    const all = (await listWorktrees(git)).filter((w) => !w.bare);
    type Item = vscode.QuickPickItem & { worktree?: Worktree; create?: boolean };
    const items: Item[] = all.map((w) => {
      const current = samePath(w.path, root);
      return {
        label: `$(${current ? "check" : w.prunable ? "warning" : w.main ? "repo" : "folder"}) ${path.basename(w.path)}`,
        description: [worktreeHeadLabel(w), current ? "current" : "", w.prunable ? "missing" : ""]
          .filter(Boolean)
          .join(" · "),
        detail: w.path,
        worktree: w,
      };
    });
    items.push(
      { label: "", kind: vscode.QuickPickItemKind.Separator },
      { label: "$(add) New Worktree…", create: true },
    );
    const picked = await vscode.window.showQuickPick(items, {
      title: "Switch Worktree",
      placeHolder: "Pick a worktree to open in this window",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) return;
    if (picked.create) return vscode.commands.executeCommand("gitTool.worktrees.new");
    if (picked.worktree && !samePath(picked.worktree.path, root))
      await openWorktree(repos, picked.worktree, "switch");
  });
}
