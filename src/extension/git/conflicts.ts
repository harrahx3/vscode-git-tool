// Opening conflicted files: VS Code's merge editor (Source Control's "Resolve in Merge Editor"),
// or the plain editor when the Git extension cannot open it.
import * as path from "path";
import * as vscode from "vscode";
import { conflictedFiles } from "./operations";
import type { Git } from "./runner";

export async function openConflict(root: string, rel: string): Promise<void> {
  const uri = vscode.Uri.file(path.join(root, rel));
  try {
    await vscode.commands.executeCommand("git.openMergeEditor", uri);
  } catch {
    await vscode.commands.executeCommand("vscode.open", uri);
  }
}

/** Opens the conflicted file, or lets the user pick one when there are several. */
export async function resolveConflicts(git: Git): Promise<void> {
  const files = await conflictedFiles(git);
  if (!files.length) {
    void vscode.window.showInformationMessage("No conflicts left.");
    return;
  }
  if (files.length === 1) return openConflict(git.root, files[0]);
  const picked = await vscode.window.showQuickPick(
    files.map((f) => ({
      label: path.posix.basename(f),
      description: path.posix.dirname(f) === "." ? "" : path.posix.dirname(f),
      file: f,
    })),
    {
      title: `Resolve Conflicts (${files.length} files)`,
      placeHolder: "Open a conflicted file in the merge editor",
    },
  );
  if (picked) await openConflict(git.root, picked.file);
}
