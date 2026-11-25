// Opening conflicted files: VS Code's merge editor (Source Control's "Resolve in Merge Editor"),
// or a choice to keep or delete the file when one side removed it and there is nothing to merge.
import * as path from "path";
import * as vscode from "vscode";
import {
  type ConflictKind,
  conflictKinds,
  conflictedFiles,
  hasMarkers,
  resolveDeletion,
  survivingSide,
} from "./operations";
import type { Git } from "./runner";

const WHY: Record<ConflictKind, string> = {
  "both-modified": "changed on both sides",
  "both-added": "added on both sides",
  "deleted-by-us": "deleted on your side and modified on the incoming side",
  "deleted-by-them": "deleted on the incoming side and modified on your side",
  "added-by-us": "added on your side only",
  "added-by-them": "added on the incoming side only",
  "both-deleted": "deleted on both sides",
};

/** Asks whether to keep or delete a file one side removed; true when it was resolved. */
async function resolveRemoved(git: Git, rel: string, kind: ConflictKind): Promise<boolean> {
  const keepable = survivingSide(kind) !== undefined;
  const picked = await vscode.window.showQuickPick(
    [
      ...(keepable
        ? [{ label: "$(check) Keep the file", detail: "Keep the version that exists.", c: "keep" }]
        : []),
      {
        label: "$(trash) Delete the file",
        detail: "Remove it from the working tree.",
        c: "delete",
      },
    ],
    {
      title: `Resolve ${path.posix.basename(rel)}`,
      placeHolder: `${rel} was ${WHY[kind]}: there is nothing to merge in an editor.`,
    },
  );
  if (!picked) return false;
  await resolveDeletion(git, rel, kind, picked.c as "keep" | "delete");
  return true;
}

/** Opens a conflicted file in the merge editor, or asks what to do when one side deleted it. */
export async function openConflict(git: Git, rel: string): Promise<void> {
  const kind = (await conflictKinds(git)).get(rel);
  if (kind && !hasMarkers(kind)) {
    await resolveRemoved(git, rel, kind);
    return;
  }
  const uri = vscode.Uri.file(path.join(git.root, rel));
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
  if (files.length === 1) return openConflict(git, files[0]);
  const kinds = await conflictKinds(git);
  const picked = await vscode.window.showQuickPick(
    files.map((f) => {
      const kind = kinds.get(f);
      const dir = path.posix.dirname(f) === "." ? "" : path.posix.dirname(f);
      return {
        label: path.posix.basename(f),
        description: dir,
        detail: kind && !hasMarkers(kind) ? WHY[kind] : undefined,
        file: f,
      };
    }),
    {
      title: `Resolve Conflicts (${files.length} files)`,
      placeHolder: "Open a conflicted file in the merge editor",
    },
  );
  if (picked) await openConflict(git, picked.file);
}
