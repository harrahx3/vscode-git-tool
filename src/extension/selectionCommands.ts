// Commands on several selected items: commits selected in the Log table (Ctrl/Shift+click) and
// branches or tags selected in the Branches view. The menus show them only on a multi-selection.
import * as vscode from "vscode";
import type { BranchNode } from "./branchesTree";
import { deleteRefs } from "./branches";
import { copyText } from "./clipboard";
import type { Register } from "./commands";
import { head } from "./git/queries";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";
import type { LogView } from "./logView";
import { treeTargets } from "../shared/selection";

/** Argument of the Log's multi-commit menu; `hashes` (newest first) is for tests and scripts. */
interface CommitsContext {
  hashes?: string[];
}

type RefNode = Extract<BranchNode, { kind: "ref" }>;
type ComparableNode = Extract<BranchNode, { kind: "ref" | "head" }>;

export function registerSelectionCommands(reg: Register, repos: Repos, log: LogView): void {
  const withGit =
    <A extends unknown[]>(fn: (git: Git, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const git = repos.currentGit();
      if (!git) return;
      await fn(git, ...args);
      repos.fire(git.root);
    };
  /** Selected commits, newest first. */
  const commits = (c?: CommitsContext) => c?.hashes ?? log.selectedCommits();

  // ---- Log: several commits -------------------------------------------------------------------

  reg("gitTool.log.compareCommits", async (c?: CommitsContext) => {
    const hashes = commits(c);
    if (hashes.length !== 2) {
      void vscode.window.showInformationMessage("Select exactly two commits to compare them.");
      return;
    }
    // Older on the left, so the file diffs read from the old commit to the new one.
    const [newer, older] = hashes;
    await vscode.commands.executeCommand("gitTool.compareBranches", older, newer);
  });
  reg("gitTool.log.copyHashes", async (c?: CommitsContext) => {
    const hashes = commits(c);
    await copyText(hashes.join("\n"));
    vscode.window.setStatusBarMessage(`$(copy) Copied ${hashes.length} hashes`, 3000);
  });
  reg(
    "gitTool.log.cherryPickCommits",
    withGit((git, c?: CommitsContext) => {
      const hashes = [...commits(c)].reverse(); // oldest first, like the history
      return withProgress(`Cherry-pick ${hashes.length} commits`, () =>
        git.write(["cherry-pick", ...hashes]),
      );
    }),
  );
  reg(
    "gitTool.log.revertCommits",
    withGit((git, c?: CommitsContext) => {
      const hashes = commits(c); // newest first, so each revert applies cleanly
      return withProgress(`Revert ${hashes.length} commits`, () =>
        git.write(["revert", "--no-edit", ...hashes]),
      );
    }),
  );

  // ---- Branches view: several branches and tags -----------------------------------------------

  const refNodes = (clicked?: BranchNode, selected?: BranchNode[]) =>
    treeTargets(clicked, selected).filter((n): n is RefNode => n.kind === "ref");

  reg("gitTool.refs.compare", async (clicked?: BranchNode, selected?: BranchNode[]) => {
    // HEAD can be one side: compare HEAD with the branch selected next to it.
    const picked = treeTargets(clicked, selected).filter(
      (n): n is ComparableNode => n.kind === "ref" || n.kind === "head",
    );
    if (picked.length !== 2) {
      void vscode.window.showInformationMessage(
        "Select exactly two branches or tags to compare them.",
      );
      return;
    }
    await vscode.commands.executeCommand(
      "gitTool.compareBranches",
      picked[0].refName,
      picked[1].refName,
    );
  });
  reg(
    "gitTool.refs.delete",
    withGit(async (git, clicked?: BranchNode, selected?: BranchNode[]) => {
      const picked = refNodes(clicked, selected).map((n) => ({ name: n.refName, kind: n.refKind }));
      if (picked.length) await deleteRefs(git, picked, (await head(git)).branch);
    }),
  );
}
