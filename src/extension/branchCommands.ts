// Commands of the Branches and Compare views, and the Checkout / New Branch / Compare buttons of
// the Log toolbar.
import * as vscode from "vscode";
import type { Ref } from "../shared/types";
import type { BranchesTree } from "./branchesTree";
import { checkout, newBranchFrom } from "./branches";
import type { Register } from "./commands";
import type { CompareView } from "./compareView";
import { head, refs } from "./git/queries";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import type { LogView } from "./logView";

interface RefArg {
  refName?: string;
  refKind?: Ref["kind"];
  ref?: Ref;
}

type RefItem = vscode.QuickPickItem & { ref?: Ref; revision?: boolean };

/** Quick pick of local branches, remote branches, tags, or any revision typed in. */
export async function pickRef(
  git: Git,
  title: string,
  exclude?: string,
): Promise<Ref | string | undefined> {
  const [h, all] = await Promise.all([head(git), refs(git)]);
  const items: RefItem[] = [{ label: "$(edit) Revision, Tag or Commit Hash…", revision: true }];
  const sections: [Ref["kind"], string][] = [
    ["head", "Local"],
    ["remote", "Remote"],
    ["tag", "Tags"],
  ];
  for (const [kind, label] of sections) {
    const list = all.filter((r) => r.kind === kind && r.name !== exclude);
    if (!list.length) continue;
    items.push({ label, kind: vscode.QuickPickItemKind.Separator });
    for (const ref of list) {
      const current = kind === "head" && ref.name === h.branch;
      const icon =
        kind === "tag" ? "tag" : current ? "check" : kind === "remote" ? "cloud" : "git-branch";
      const track = [ref.ahead ? `↑${ref.ahead}` : "", ref.behind ? `↓${ref.behind}` : ""];
      items.push({
        label: `$(${icon}) ${ref.name}`,
        description: [current ? "current" : "", ref.upstream ?? "", ...track]
          .filter(Boolean)
          .join("  "),
        ref,
      });
    }
  }
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: "Type to search branches and tags",
    matchOnDescription: true,
  });
  if (!picked) return undefined;
  if (picked.revision)
    return (
      await vscode.window.showInputBox({ title, prompt: "Revision, tag or commit hash" })
    )?.trim();
  return picked.ref;
}

const nameOf = (r: Ref | string) => (typeof r === "string" ? r : r.name);

export function registerBranchCommands(
  reg: Register,
  repos: Repos,
  log: LogView,
  branches: BranchesTree,
  compare: CompareView,
): void {
  const withGit =
    <A extends unknown[]>(fn: (git: Git, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const git = repos.currentGit();
      if (!git) return;
      await fn(git, ...args);
      repos.fire(git.root);
    };

  reg(
    "gitTool.checkout",
    withGit(async (git) => {
      const target = await pickRef(git, "Checkout");
      if (!target) return;
      if (typeof target === "string")
        await checkout(git, { name: target, kind: "tag" }); // detached, like a tag
      else await checkout(git, target);
    }),
  );
  reg(
    "gitTool.newBranch",
    withGit(async (git) => {
      const h = await head(git);
      await newBranchFrom(git, "HEAD", h.branch ?? "HEAD");
    }),
  );

  // ---- Compare --------------------------------------------------------------------------------

  /** Compares `left` and `right`; asks for the missing ones (current branch first). */
  reg(
    "gitTool.compareBranches",
    withGit(async (git, left?: unknown, right?: unknown) => {
      let l = typeof left === "string" ? left : undefined;
      let r = typeof right === "string" ? right : undefined;
      if (!l) {
        const picked = await pickRef(git, "Compare Branches (1/2): first branch");
        if (!picked) return;
        l = nameOf(picked);
      }
      if (!r) {
        const picked = await pickRef(git, `Compare '${l}' with…`, l);
        if (!picked) return;
        r = nameOf(picked);
      }
      await compare.compare(l, r);
    }),
  );
  reg("gitTool.ref.compareWith", async (arg?: RefArg, selected?: RefArg[]) => {
    const picked = (selected ?? []).filter((s) => s.refName);
    if (picked.length === 2)
      return vscode.commands.executeCommand(
        "gitTool.compareBranches",
        picked[0].refName,
        picked[1].refName,
      );
    return vscode.commands.executeCommand("gitTool.compareBranches", arg?.refName);
  });
  reg("gitTool.compare.diff", (node: unknown) => compare.openDiff(node));
  reg("gitTool.compare.compareWithLocal", (node: unknown) => compare.compareWithLocal(node));
  reg("gitTool.compare.swap", () => compare.swap());
  reg("gitTool.compare.refresh", () => compare.refresh());
  reg("gitTool.compare.close", () => compare.close());

  // ---- Branches view --------------------------------------------------------------------------

  reg("gitTool.ref.showInLog", (arg?: RefArg) => {
    if (arg?.ref) return log.show(undefined, arg.ref.hash);
  });
  reg("gitTool.ref.showHistory", (arg?: RefArg) => {
    if (arg?.refName) return log.show({ branch: arg.refName });
  });
  reg("gitTool.branches.refresh", () => branches.refresh(true));
}
