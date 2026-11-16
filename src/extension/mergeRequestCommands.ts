// Commands of the Merge Requests view.
import * as vscode from "vscode";
import type { MergeRequest } from "../shared/mergeRequests";
import { mergeRequestHeadRef, mergeRequestRef } from "../shared/remote";
import { checkout } from "./branches";
import { openInBrowser } from "./browserCommands";
import { copyText } from "./clipboard";
import type { Register } from "./commands";
import type { CompareView } from "./compareView";
import { refs } from "./git/queries";
import type { Repos } from "./git/repos";
import { withProgress } from "./git/ui";
import { hostingOf, type HostingApi } from "./hosting";
import {
  MERGE_REQUESTS_VIEW_ID,
  type MergeRequestChanges,
  type MergeRequestsTree,
} from "./mergeRequestsTree";
import { pickSort } from "./sortPick";

const mrOf = (node: unknown): MergeRequest | undefined => {
  const n = node as { kind?: string; mr?: MergeRequest } | undefined;
  return n?.kind === "mr" ? n.mr : undefined;
};

export function registerMergeRequestCommands(
  reg: Register,
  repos: Repos,
  api: HostingApi,
  tree: MergeRequestsTree,
  compare: CompareView,
): void {
  reg("gitTool.mergeRequests.refresh", () => tree.refresh());
  reg("gitTool.mergeRequests.sort", async () => {
    const key = await pickSort(
      tree.sortKey(),
      tree.hosting?.provider === "github" ? "Pull Requests" : "Merge Requests",
    );
    if (key) await tree.setSort(key);
  });
  reg("gitTool.mergeRequests.show", async () => {
    await vscode.commands.executeCommand(`${MERGE_REQUESTS_VIEW_ID}.focus`);
  });

  const hosting = async () => {
    const git = repos.currentGit();
    return git && hostingOf(git);
  };
  reg("gitTool.mergeRequests.signIn", async () => {
    const h = await hosting();
    // The Merge Requests and Issues views reload on api.onDidChangeCredentials.
    if (h) await api.signIn(h);
  });
  reg("gitTool.mergeRequests.signOut", async () => {
    const h = await hosting();
    if (!h) return;
    await api.signOut(h);
    void vscode.window.showInformationMessage(`The access token for ${h.host} was removed.`);
  });

  reg("gitTool.mr.openInBrowser", async (node: unknown) => {
    const mr = mrOf(node);
    if (mr) await openInBrowser(mr.url);
  });
  reg("gitTool.mr.copyLink", async (node: unknown) => {
    const mr = mrOf(node);
    if (!mr) return;
    await copyText(mr.url);
    vscode.window.setStatusBarMessage("$(link) Link copied", 3000);
  });
  reg("gitTool.mr.diff", (node: unknown) => tree.openDiff(node));

  reg("gitTool.mr.compare", async (node: unknown) => {
    const mr = mrOf(node);
    if (!mr) return;
    let changes: MergeRequestChanges | undefined;
    const ok = await withProgress(`Fetch ${mr.source}`, async () => {
      changes = await tree.changesOf(mr);
    });
    if (ok && changes) await compare.compare(changes.base, changes.head);
  });

  /** Checks out the source branch (a fork's merge request: a local `mr/<id>` branch). */
  reg("gitTool.mr.checkout", async (node: unknown) => {
    const mr = mrOf(node);
    const h = tree.hosting;
    const git = repos.currentGit();
    if (!mr || !h || !git) return;
    if (!mr.fork) {
      const fetched = await withProgress(`Fetch ${mr.source}`, () =>
        git.network(["fetch", h.remote, mr.source]),
      );
      if (!fetched) return;
      await checkout(git, { name: `${h.remote}/${mr.source}`, kind: "remote" });
    } else {
      const ref = mergeRequestRef(h.provider, mr.id);
      const fetched = await withProgress(`Fetch ${ref}`, () =>
        git.network(["fetch", h.remote, mergeRequestHeadRef(h.provider, mr.id)]),
      );
      if (!fetched) return;
      const local = `mr/${mr.id}`;
      const exists = (await refs(git)).some((r) => r.kind === "head" && r.name === local);
      let args = ["switch", "-c", local, "FETCH_HEAD"];
      if (exists) {
        const choice = await vscode.window.showWarningMessage(
          `A local branch '${local}' already exists.`,
          { modal: true },
          "Check Out Local Branch",
          `Reset to ${ref} and Check Out`,
        );
        if (!choice) return;
        args =
          choice === "Check Out Local Branch"
            ? ["switch", local]
            : ["switch", "-C", local, "FETCH_HEAD"];
      }
      await withProgress(`Checkout ${local}`, () => git.write(args));
    }
    repos.fire(git.root);
  });
}
