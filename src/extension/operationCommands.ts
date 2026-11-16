// Finishing what stopped half-way (merge, rebase, cherry-pick, revert, a stash that did not
// re-apply): resolve the conflicts, continue, skip a commit, abort; stash and unstash; and tags.
import * as path from "path";
import * as vscode from "vscode";
import { displayRef } from "../shared/selection";
import type { Register } from "./commands";
import { openConflict, resolveConflicts } from "./git/conflicts";
import {
  OPERATION_LABEL,
  abortOperation,
  continueOperation,
  currentOperation,
  filesWithMarkers,
  markResolved,
  skipCommit,
  stashChanges,
  unstashChanges,
} from "./git/operations";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";
import { newTag, pushAllTags, pushTag } from "./tags";

interface PathArg {
  change?: { path: string };
  path?: string;
}
interface RefArg {
  refName?: string;
  refKind?: string;
}

const pathOf = (arg?: PathArg) => arg?.change?.path ?? arg?.path;

export function registerOperationCommands(reg: Register, repos: Repos): void {
  const withGit =
    <A extends unknown[]>(fn: (git: Git, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const git = repos.currentGit();
      if (!git) return;
      await fn(git, ...args);
      repos.fire(git.root);
    };

  /** Stops with a message when conflict markers remain; true when it is safe to go on. */
  const markersResolved = async (git: Git) => {
    const marked = await filesWithMarkers(git);
    if (!marked.length) return true;
    const choice = await vscode.window.showWarningMessage(
      `${marked.length === 1 ? marked[0] : `${marked.length} files`} still ${marked.length === 1 ? "has" : "have"} conflict markers.`,
      "Resolve Conflicts",
    );
    if (choice) await resolveConflicts(git);
    return false;
  };

  reg(
    "gitTool.operation.resolve",
    withGit((git) => resolveConflicts(git)),
  );
  reg(
    "gitTool.operation.continue",
    withGit(async (git) => {
      const op = await currentOperation(git);
      if (!(await markersResolved(git))) return;
      if (!op) return withProgress("Mark resolved", () => markResolved(git));
      await withProgress(`Continue ${OPERATION_LABEL[op]}`, () => continueOperation(git, op));
    }),
  );
  reg(
    "gitTool.operation.markResolved",
    withGit(async (git) => {
      if (await markersResolved(git)) await withProgress("Mark resolved", () => markResolved(git));
    }),
  );
  reg(
    "gitTool.operation.skip",
    withGit(async (git) => {
      const op = await currentOperation(git);
      if (op && op !== "merge")
        await withProgress(`Skip commit (${OPERATION_LABEL[op]})`, () => skipCommit(git, op));
    }),
  );
  reg(
    "gitTool.operation.abort",
    withGit(async (git) => {
      const op = await currentOperation(git);
      if (!op) return;
      const label = OPERATION_LABEL[op];
      const ok = await vscode.window.showWarningMessage(
        `Abort the ${label.toLowerCase()}?`,
        {
          modal: true,
          detail: `The branch goes back to where it was before the ${label.toLowerCase()}; conflict resolutions done so far are lost.`,
        },
        `Abort ${label}`,
      );
      if (ok) await withProgress(`Abort ${label}`, () => abortOperation(git, op));
    }),
  );

  // ---- One conflicted file (Changes view) -----------------------------------------------------

  reg("gitTool.change.resolve", (arg?: PathArg) => {
    const root = repos.currentRoot();
    const file = pathOf(arg);
    if (root && file) return openConflict(root, file);
  });
  const take = (side: "ours" | "theirs") =>
    withGit(async (git, arg?: PathArg) => {
      const file = pathOf(arg);
      if (!file) return;
      await withProgress(`Accept ${side} for ${path.posix.basename(file)}`, async () => {
        await git.write(["checkout", `--${side}`, "--", file]);
        await git.write(["add", "--", file]);
      });
    });
  reg("gitTool.change.acceptOurs", take("ours"));
  reg("gitTool.change.acceptTheirs", take("theirs"));

  // ---- Stash ----------------------------------------------------------------------------------

  reg(
    "gitTool.stash.push",
    withGit(async (git) => {
      const message = await vscode.window.showInputBox({
        title: "Stash Changes",
        prompt: "Message (optional)",
        placeHolder: "Work in progress",
      });
      if (message === undefined) return;
      await withProgress("Stash", async () => {
        if (!(await stashChanges(git, message.trim() || "Git Tool stash")))
          void vscode.window.showInformationMessage("No local changes to stash.");
      });
    }),
  );
  reg(
    "gitTool.stash.pop",
    withGit((git) => withProgress("Unstash", () => unstashChanges(git))),
  );

  // ---- Tags -----------------------------------------------------------------------------------

  reg(
    "gitTool.newTag",
    withGit(async (git) => {
      const branch = (
        await git.run(["symbolic-ref", "-q", "--short", "HEAD"], { okCodes: [1] })
      ).trim();
      await newTag(git, "HEAD", branch || "HEAD");
    }),
  );
  reg(
    "gitTool.ref.newTag",
    withGit((git, r?: RefArg) =>
      r?.refName ? newTag(git, r.refName, displayRef(r.refName)) : Promise.resolve(),
    ),
  );
  reg(
    "gitTool.ref.pushTag",
    withGit((git, r?: RefArg) => (r?.refName ? pushTag(git, r.refName) : Promise.resolve())),
  );
  reg(
    "gitTool.pushTags",
    withGit((git) => pushAllTags(git)),
  );
}
