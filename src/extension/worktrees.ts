// Worktree operations: list, open (switch to), create, delete and prune.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { refNameProblem } from "../shared/refNames";
import type { Ref } from "../shared/types";
import {
  defaultWorktreePath,
  parseWorktrees,
  worktreeHeadLabel,
  type Worktree,
} from "../shared/worktrees";
import { deleteRef } from "./branches";
import { refs } from "./git/queries";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";

export async function listWorktrees(git: Git): Promise<Worktree[]> {
  return parseWorktrees(await git.run(["worktree", "list", "--porcelain"]));
}

/** Resolved path, for comparing git's paths with VS Code's (symlinks, trailing slashes). */
export function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

export type OpenMode = "switch" | "newWindow" | "addToWorkspace";

/**
 * Switch: when the worktree is already a folder of this workspace, the views show it; else this
 * window reopens on it. New window and Add to Workspace do what they say.
 */
export async function openWorktree(repos: Repos, w: Worktree, mode: OpenMode): Promise<void> {
  if (w.prunable || !fs.existsSync(w.path)) {
    void vscode.window.showErrorMessage(`The folder of this worktree is gone: ${w.path}`);
    return;
  }
  const uri = vscode.Uri.file(w.path);
  if (mode === "addToWorkspace") {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.some((f) => samePath(f.uri.fsPath, w.path))) return;
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri });
    return;
  }
  if (mode === "switch") {
    const root = repos.roots().find((r) => samePath(r, w.path));
    if (root) {
      repos.setCurrent(root);
      vscode.window.setStatusBarMessage(`$(check) Showing worktree ${path.basename(root)}`, 4000);
      return;
    }
  }
  await vscode.commands.executeCommand(
    "vscode.openFolder",
    uri,
    mode === "newWindow" ? { forceNewWindow: true } : { forceReuseWindow: true },
  );
}

/** After a worktree was created: offer to open it. */
async function offerOpen(repos: Repos, w: Worktree): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `Created worktree ${path.basename(w.path)} (${worktreeHeadLabel(w)}).`,
    "Open",
    "Open in New Window",
    "Add to Workspace",
  );
  const mode: Record<string, OpenMode> = {
    Open: "switch",
    "Open in New Window": "newWindow",
    "Add to Workspace": "addToWorkspace",
  };
  if (choice) await openWorktree(repos, w, mode[choice]);
}

async function askNewBranch(git: Git, prompt: string, value = "", optional = false) {
  const existing = (await refs(git)).filter((r) => r.kind === "head").map((r) => r.name);
  const name = await vscode.window.showInputBox({
    title: "New Worktree",
    prompt,
    value,
    validateInput: (v) =>
      optional && !v.trim() ? undefined : refNameProblem(v, existing, "branch"),
  });
  return name === undefined ? undefined : name.trim();
}

/** `git worktree add` options and commit-ish for a target, asking for a branch when needed. */
async function checkoutArgs(
  git: Git,
  target: Ref | string,
  worktrees: Worktree[],
): Promise<{ options: string[]; commitish: string; branch: string } | undefined> {
  const locals = (await refs(git)).filter((r) => r.kind === "head").map((r) => r.name);
  let local: string | undefined;
  if (typeof target !== "string" && target.kind === "head") local = target.name;
  if (typeof target !== "string" && target.kind === "remote") {
    const short = target.name.slice(target.name.indexOf("/") + 1);
    if (locals.includes(short)) local = short;
    else return { options: ["--track", "-b", short], commitish: target.name, branch: short };
  }
  if (local) {
    const usedBy = worktrees.find((w) => w.branch === local);
    if (!usedBy) return { options: [], commitish: local, branch: local };
    const name = await askNewBranch(
      git,
      `'${local}' is checked out in ${usedBy.path}. Name of a new branch from it`,
      `${local}-2`,
    );
    return name ? { options: ["-b", name], commitish: local, branch: name } : undefined;
  }
  const rev = typeof target === "string" ? target : target.name;
  const name = await askNewBranch(
    git,
    `New branch from ${rev} (leave empty for a detached HEAD)`,
    "",
    true,
  );
  if (name === undefined) return undefined;
  return name
    ? { options: ["-b", name], commitish: rev, branch: name }
    : { options: ["--detach"], commitish: rev, branch: rev };
}

/** Creates a worktree checking out `target`, then offers to open it. */
export async function newWorktree(repos: Repos, git: Git, target: Ref | string): Promise<boolean> {
  const worktrees = await listWorktrees(git);
  const args = await checkoutArgs(git, target, worktrees);
  if (!args) return false;
  const main = worktrees.find((w) => w.main)?.path ?? git.root;
  const where = await vscode.window.showInputBox({
    title: "New Worktree",
    prompt: `Folder of the new worktree for ${args.branch}`,
    value: defaultWorktreePath(main, args.branch),
    validateInput: (v) =>
      !v.trim()
        ? "Enter a folder"
        : fs.existsSync(path.resolve(git.root, v.trim())) &&
            fs.readdirSync(path.resolve(git.root, v.trim())).length
          ? "This folder exists and is not empty"
          : undefined,
  });
  if (!where?.trim()) return false;
  const folder = path.resolve(git.root, where.trim());
  const ok = await withProgress(`New worktree ${path.basename(folder)}`, () =>
    git.write(["worktree", "add", ...args.options, folder, args.commitish]),
  );
  if (!ok) return false;
  const created = (await listWorktrees(git)).find((w) => samePath(w.path, folder));
  if (created) void offerOpen(repos, created);
  return true;
}

/**
 * Deletes worktrees (their folders; branches are kept unless asked). The main working tree and
 * the one the views show cannot be deleted from here.
 */
export async function deleteWorktrees(
  git: Git,
  all: Worktree[],
  currentRoot: string | undefined,
): Promise<boolean> {
  const isCurrent = (w: Worktree) => !!currentRoot && samePath(w.path, currentRoot);
  const kept = all.filter((w) => w.main || isCurrent(w));
  const list = all.filter((w) => !w.main && !isCurrent(w));
  if (kept.length)
    void vscode.window.showInformationMessage(
      `Kept ${kept.map((w) => path.basename(w.path)).join(", ")}: the main worktree and the one open here cannot be deleted.`,
    );
  if (!list.length) return false;
  const names = list.map((w) => `${path.basename(w.path)} (${worktreeHeadLabel(w)})`);
  const branches = list.map((w) => w.branch).filter((b): b is string => !!b);
  const locked = list.filter((w) => w.locked !== undefined);
  const detail = [
    list.length === 1 ? `Removes the folder ${list[0].path}.` : `Removes their folders.`,
    locked.length ? `Locked: ${locked.map((w) => path.basename(w.path)).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const DELETE = list.length === 1 ? "Delete Worktree" : "Delete Worktrees";
  const WITH_BRANCH = branches.length === 1 ? "Delete Worktree and Branch" : "Delete with Branches";
  const choice = await vscode.window.showWarningMessage(
    list.length === 1 ? `Delete worktree ${names[0]}?` : `Delete ${list.length} worktrees?`,
    { modal: true, detail: list.length === 1 ? detail : `${names.join("\n")}\n\n${detail}` },
    DELETE,
    ...(branches.length ? [WITH_BRANCH] : []),
  );
  if (!choice) return false;
  let ok = true;
  for (const w of list) {
    if (!(await removeOne(git, w))) {
      ok = false;
      continue;
    }
    if (choice === WITH_BRANCH && w.branch)
      ok = (await deleteRef(git, { name: w.branch, kind: "head" })) && ok;
  }
  return ok;
}

async function removeOne(git: Git, w: Worktree): Promise<boolean> {
  const name = path.basename(w.path);
  // A locked worktree needs the force flag twice.
  const force = w.locked !== undefined ? ["--force", "--force"] : [];
  try {
    await git.write(["worktree", "remove", ...force, w.path]);
    vscode.window.setStatusBarMessage(`$(trash) Deleted worktree ${name}`, 4000);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/contains modified or untracked files/.test(message)) {
      void vscode.window.showErrorMessage(`Delete worktree ${name} failed: ${message}`);
      return false;
    }
    const anyway = await vscode.window.showWarningMessage(
      `Worktree ${name} has uncommitted changes or untracked files.`,
      { modal: true, detail: "They are deleted with the folder." },
      "Delete Anyway",
    );
    if (!anyway) return false;
    return withProgress(`Delete worktree ${name}`, () =>
      git.write(["worktree", "remove", "--force", ...force, w.path]),
    );
  }
}

/** Forgets the worktrees whose folder is gone. */
export async function pruneWorktrees(git: Git): Promise<boolean> {
  const gone = (await listWorktrees(git)).filter((w) => w.prunable);
  if (!gone.length) {
    void vscode.window.showInformationMessage("No missing worktree to prune.");
    return false;
  }
  return withProgress(`Prune ${gone.length} missing worktree(s)`, () =>
    git.write(["worktree", "prune"]),
  );
}
