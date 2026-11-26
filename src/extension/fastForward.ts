// Update local branches from their upstream without checking them out: fetch, then move each
// branch ref forward with `git update-ref` (which checks the old value, so nothing is lost if
// the branch moved meanwhile). Only fast-forwards: a branch with local commits is left alone.
import * as vscode from "vscode";
import {
  fastForwardStatus,
  fastForwardSummary,
  remoteOf,
  type FastForwardResult,
} from "../shared/fastForward";
import { gitPathToLocal } from "../shared/winPaths";
import { parseWorktrees } from "../shared/worktrees";
import { head, refs } from "./git/queries";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";

/**
 * Fast-forwards the named local branches to their upstream. The current branch, if named, is
 * pulled instead (the working tree must follow it). Returns false when the fetch failed.
 */
export async function fastForwardBranches(git: Git, names: string[]): Promise<boolean> {
  const [h, before, remoteList] = await Promise.all([
    head(git),
    refs(git),
    git.run(["remote"]).then((out) => out.split("\n").filter(Boolean)),
  ]);
  const others = names.filter((n) => n !== h.branch);
  let ok = true;
  if (others.length) {
    // One fetch per remote; only the branch itself when it is the only one on that remote.
    const fetches = new Map<string, string[]>();
    for (const name of others) {
      const upstream = before.find((r) => r.kind === "head" && r.name === name)?.upstream;
      const remote = upstream && remoteOf(upstream, remoteList);
      if (remote) fetches.set(remote, [...(fetches.get(remote) ?? []), upstream]);
    }
    const results: FastForwardResult[] = [];
    const title = others.length === 1 ? `Update ${others[0]}` : `Update ${others.length} branches`;
    ok = await withProgress(title, async () => {
      results.length = 0;
      for (const [remote, upstreams] of fetches) {
        const only = upstreams.length === 1 ? [upstreams[0].slice(remote.length + 1)] : [];
        await git.network(["fetch", remote, ...only]);
      }
      const [all, worktreeList] = await Promise.all([
        refs(git),
        git.run(["worktree", "list", "--porcelain"]),
      ]);
      const worktrees = parseWorktrees(worktreeList);
      for (const name of others) {
        const ref = all.find((r) => r.kind === "head" && r.name === name);
        if (!ref) continue;
        const elsewhere = worktrees.find((w) => w.branch === name)?.path;
        const status = fastForwardStatus(ref, all, elsewhere && gitPathToLocal(elsewhere));
        if (status.kind === "move")
          await git.write([
            "update-ref",
            "-m",
            `fast-forward to ${status.upstream}`,
            `refs/heads/${name}`,
            status.to,
            status.from,
          ]);
        results.push({ name, status });
      }
    });
    if (ok && results.length) {
      const { message, warning } = fastForwardSummary(results);
      if (warning) void vscode.window.showWarningMessage(message);
      else void vscode.window.showInformationMessage(message);
    }
  }
  if (h.branch && names.includes(h.branch)) await vscode.commands.executeCommand("gitTool.update");
  return ok;
}
