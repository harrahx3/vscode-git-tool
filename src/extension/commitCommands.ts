// Commands of the Commit view's file list: row buttons, context menus and title bar. Menu
// commands get the row's context; Changes.targets() turns it into the files to act on.
import * as path from "path";
import * as vscode from "vscode";
import { isUntracked } from "../shared/changeGroups";
import type { WorkingChange } from "../shared/types";
import type { Changes } from "./changes";
import type { Register } from "./commands";
import { rollback } from "./git/operations";
import type { Repos } from "./git/repos";
import { withProgress } from "./git/ui";

const describe = (files: WorkingChange[]) =>
  files.length === 1 ? `'${path.basename(files[0].path)}'` : `${files.length} files`;

export function registerCommitCommands(reg: Register, repos: Repos, tree: Changes): void {
  /** Runs `fn` with the repository and the targeted files, then refreshes. */
  const onFiles =
    (fn: (root: string, files: WorkingChange[], arg: unknown) => Promise<unknown>) =>
    async (arg?: unknown) => {
      const root = tree.root;
      if (!root) return;
      const files = tree.targets(arg);
      if (!files.length) {
        void vscode.window.showInformationMessage("Select the changed files first.");
        return;
      }
      await fn(root, files, arg);
      repos.fire(root);
      await tree.refresh();
    };
  const onRoot = (fn: (root: string) => Promise<unknown>) => async () => {
    if (!tree.root) return;
    await fn(tree.root);
    await tree.refresh();
  };
  const fileUri = (root: string, c: WorkingChange) => vscode.Uri.file(path.join(root, c.path));

  reg("gitTool.change.diff", async (arg?: unknown) => {
    for (const c of tree.targets(arg).slice(0, 10)) await tree.openDiff(c);
  });
  reg("gitTool.change.open", async (arg?: unknown) => {
    const root = tree.root;
    if (!root) return;
    const files = tree.targets(arg).filter((c) => c.worktree !== "D");
    for (const c of files.slice(0, 10))
      await vscode.commands.executeCommand("vscode.open", fileUri(root, c), {
        preview: files.length === 1,
      });
  });
  reg("gitTool.change.history", (arg?: unknown) => {
    const root = tree.root;
    const c = tree.targets(arg)[0];
    if (root && c)
      return vscode.commands.executeCommand("gitTool.showFileHistory", fileUri(root, c));
  });

  reg(
    "gitTool.change.rollback",
    onFiles(async (root, files) => {
      const tracked = files.filter((c) => !isUntracked(c));
      const skipped = files.length - tracked.length;
      if (!tracked.length) {
        void vscode.window.showInformationMessage(
          "Unversioned files have nothing to roll back: use Delete to remove them.",
        );
        return;
      }
      const detail = [
        "Local changes are lost. Added files are unstaged and kept on disk.",
        skipped ? `${skipped} unversioned file(s) in the selection are left untouched.` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const ok = await vscode.window.showWarningMessage(
        `Roll back the changes of ${describe(tracked)}?`,
        { modal: true, detail },
        "Rollback",
      );
      if (ok) await withProgress("Rollback", () => rollback(repos.git(root), tracked));
    }),
  );
  reg(
    "gitTool.change.delete",
    onFiles(async (root, files) => {
      const untracked = files.filter(isUntracked);
      if (!untracked.length) return;
      const ok = await vscode.window.showWarningMessage(
        `Delete ${describe(untracked)}?`,
        { modal: true, detail: "The files are moved to the trash." },
        "Delete",
      );
      if (!ok) return;
      for (const c of untracked)
        await vscode.workspace.fs.delete(fileUri(root, c), { useTrash: true });
    }),
  );
  reg(
    "gitTool.change.ignore",
    onFiles(async (root, files) => {
      const untracked = files.filter(isUntracked);
      if (!untracked.length) return;
      const uri = vscode.Uri.file(path.join(root, ".gitignore"));
      let text = "";
      try {
        text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        // No .gitignore yet.
      }
      const sep = text && !text.endsWith("\n") ? "\n" : "";
      const lines = untracked.map((c) => `/${c.path}`).join("\n");
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(`${text}${sep}${lines}\n`));
    }),
  );
  reg(
    "gitTool.change.moveTo",
    onFiles(async (root, files, arg) => {
      const tracked = files.filter((c) => !isUntracked(c));
      if (!tracked.length) return;
      const NEW = "$(add) New Changelist…";
      const current = tree.listOf(arg)?.name;
      const lists = tree.changelists.names(root).filter((l) => l !== current);
      const picked = await vscode.window.showQuickPick([...lists, NEW], {
        title: `Move ${describe(tracked)} to Another Changelist`,
      });
      if (!picked) return;
      const name =
        picked === NEW ? await vscode.window.showInputBox({ prompt: "Changelist name" }) : picked;
      if (name?.trim())
        await tree.changelists.move(
          root,
          tracked.map((c) => c.path),
          name.trim(),
        );
    }),
  );

  // ---- Changelists ----------------------------------------------------------------------------

  reg(
    "gitTool.newChangelist",
    onRoot(async (root) => {
      const name = await vscode.window.showInputBox({ prompt: "New changelist name" });
      if (name?.trim()) await tree.changelists.create(root, name.trim(), false);
    }),
  );
  const onList =
    (fn: (root: string, list: string) => Promise<unknown>) => async (arg?: unknown) => {
      const list = tree.listOf(arg)?.name;
      if (!tree.root || !list) return;
      await fn(tree.root, list);
      await tree.refresh();
    };
  reg(
    "gitTool.changelist.setActive",
    onList((root, list) => tree.changelists.setActive(root, list)),
  );
  reg(
    "gitTool.changelist.rename",
    onList(async (root, list) => {
      const to = await vscode.window.showInputBox({ prompt: "Rename changelist", value: list });
      if (to?.trim()) await tree.changelists.rename(root, list, to.trim());
    }),
  );
  reg(
    "gitTool.changelist.remove",
    onList((root, list) => tree.changelists.remove(root, list)),
  );
}
