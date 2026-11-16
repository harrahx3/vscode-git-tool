// Commands of the Issues view.
import * as vscode from "vscode";
import { issueBranchName, type Issue } from "../shared/issues";
import { refNameProblem } from "../shared/refNames";
import { issuesUrl, newIssueUrl } from "../shared/remote";
import { openInBrowser } from "./browserCommands";
import { copyText } from "./clipboard";
import type { Register } from "./commands";
import { head, refs } from "./git/queries";
import type { Repos } from "./git/repos";
import { withProgress } from "./git/ui";
import { hostingOf } from "./hosting";
import { ISSUES_VIEW_ID, type IssuesTree } from "./issuesTree";
import { pickSort } from "./sortPick";

const issueOf = (node: unknown): Issue | undefined => {
  const n = node as { kind?: string; issue?: Issue } | undefined;
  return n?.kind === "issue" ? n.issue : undefined;
};

export function registerIssueCommands(reg: Register, repos: Repos, tree: IssuesTree): void {
  reg("gitTool.issues.refresh", () => tree.refresh());
  reg("gitTool.issues.sort", async () => {
    const key = await pickSort(tree.sortKey(), "Issues");
    if (key) await tree.setSort(key);
  });
  reg("gitTool.issues.show", async () => {
    await vscode.commands.executeCommand(`${ISSUES_VIEW_ID}.focus`);
  });

  const hosting = async () => {
    const git = repos.currentGit();
    return git && hostingOf(git);
  };
  reg("gitTool.openIssuesInBrowser", async () => {
    const h = await hosting();
    if (h) await openInBrowser(issuesUrl(h));
  });
  reg("gitTool.issues.new", async () => {
    const h = await hosting();
    if (h) await openInBrowser(newIssueUrl(h));
  });

  reg("gitTool.issue.openInBrowser", async (node: unknown) => {
    const issue = issueOf(node);
    if (issue) await openInBrowser(issue.url);
  });
  reg("gitTool.issue.copyLink", async (node: unknown) => {
    const issue = issueOf(node);
    if (!issue) return;
    await copyText(issue.url);
    vscode.window.setStatusBarMessage("$(link) Link copied", 3000);
  });

  /** A new branch from the current HEAD, named after the issue (`12-fix-the-login-page`). */
  reg("gitTool.issue.createBranch", async (node: unknown) => {
    const issue = issueOf(node);
    const git = repos.currentGit();
    if (!issue || !git) return;
    const existing = (await refs(git)).filter((r) => r.kind === "head").map((r) => r.name);
    const current = await head(git);
    const from = current.branch ?? current.hash?.slice(0, 8) ?? "HEAD";
    const name = await vscode.window.showInputBox({
      title: `New Branch for #${issue.id}`,
      prompt: `New branch from ${from}, checked out`,
      value: issueBranchName(issue),
      validateInput: (v) => refNameProblem(v, existing, "branch"),
    });
    if (!name) return;
    await withProgress(`New branch ${name.trim()}`, () => git.write(["switch", "-c", name.trim()]));
    repos.fire(git.root);
  });
}
