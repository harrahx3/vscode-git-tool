// "Open in Browser" commands: the repository, a branch or tag, a commit, a file (with the
// selected lines) and merge requests on the remote's web host (GitLab, GitHub, Bitbucket).
import * as vscode from "vscode";
import type { MergeRequest } from "../shared/mergeRequests";
import {
  branchMergeRequestsUrl,
  branchUrl,
  commitUrl,
  fileUrl,
  mergeRequestRef,
  mergeRequestsUrl,
  mergeRequestWord,
  newMergeRequestUrl,
  repositoryUrl,
  tagUrl,
} from "../shared/remote";
import { copyText, openExternal } from "./clipboard";
import type { Register } from "./commands";
import { head } from "./git/queries";
import type { Repos } from "./git/repos";
import type { Git } from "./git/runner";
import {
  AuthRequired,
  hostingOf,
  isOnRemote,
  remoteNames,
  splitRemoteRef,
  type Hosting,
  type HostingApi,
} from "./hosting";
import { commitMergeRequests, openMergeRequests } from "./mergeRequestApi";

interface RefArg {
  refName?: string;
  refKind?: "head" | "remote" | "tag";
}
interface CommitArg {
  hash?: string;
}
interface CommitFileArg {
  hash?: string;
  path?: string;
}

/** Opens web pages; the integration tests record the URLs instead. */
let opener = openExternal;

export function openInBrowser(url: string): Thenable<boolean> {
  return opener(url);
}

/** For the integration tests: URLs are recorded in the returned list instead of opened. */
export function captureBrowser(): string[] {
  const urls: string[] = [];
  opener = async (url) => {
    urls.push(url);
    return true;
  };
  return urls;
}

/** Asks before opening a page the remote does not have yet; true = go on. */
async function confirmMissing(message: string, push?: () => Thenable<unknown>): Promise<boolean> {
  const actions = push ? ["Push…", "Open Anyway"] : ["Open Anyway"];
  const choice = await vscode.window.showWarningMessage(message, ...actions);
  if (choice === "Push…") await push?.();
  return choice === "Open Anyway";
}

/**
 * Where a branch lives on the remote: a remote branch's own remote, a local branch's upstream,
 * else the default remote under the same name (`pushed` false when it is not there).
 */
async function remoteBranch(
  git: Git,
  ref: RefArg,
): Promise<{ h: Hosting; branch: string; pushed: boolean } | undefined> {
  const name = ref.refName!;
  if (ref.refKind === "remote") {
    const parts = splitRemoteRef(name, await remoteNames(git));
    const h = parts && (await hostingOf(git, parts.remote));
    return h && { h, branch: parts.branch, pushed: true };
  }
  const upstream = (
    await git.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${name}@{upstream}`], {
      okCodes: [128],
    })
  ).trim();
  const parts = upstream ? splitRemoteRef(upstream, await remoteNames(git)) : undefined;
  if (parts) {
    const h = await hostingOf(git, parts.remote);
    return h && { h, branch: parts.branch, pushed: true };
  }
  const h = await hostingOf(git);
  if (!h) return undefined;
  const pushed = !!(
    await git.run(["rev-parse", "-q", "--verify", `refs/remotes/${h.remote}/${name}`], {
      okCodes: [1],
    })
  ).trim();
  return { h, branch: name, pushed };
}

/** The ref argument, or the current branch when the command runs from the palette. */
async function refOrCurrent(git: Git, ref?: RefArg): Promise<RefArg | undefined> {
  if (ref?.refName) return ref;
  const branch = (await head(git)).branch;
  if (!branch) void vscode.window.showWarningMessage("HEAD is detached: check out a branch first.");
  return branch ? { refName: branch, refKind: "head" } : undefined;
}

/** Lets the user choose when several merge requests match; opens the one chosen. */
async function openOneOf(h: Hosting, mrs: MergeRequest[], title: string): Promise<void> {
  if (mrs.length === 1) {
    await openInBrowser(mrs[0].url);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    mrs.map((m) => ({
      label: `${mergeRequestRef(h.provider, m.id)} ${m.title}`,
      description: `${m.source} → ${m.target} · ${m.authorName}`,
      m,
    })),
    { title },
  );
  if (picked) await openInBrowser(picked.m.url);
}

export function registerBrowserCommands(reg: Register, repos: Repos, api: HostingApi): void {
  const withGit =
    <A extends unknown[]>(fn: (git: Git, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      const git = repos.currentGit();
      if (git) await fn(git, ...args);
    };

  reg(
    "gitTool.openRepositoryInBrowser",
    withGit(async (git) => {
      const h = await hostingOf(git);
      if (h) await openInBrowser(repositoryUrl(h));
    }),
  );
  reg(
    "gitTool.openMergeRequestsInBrowser",
    withGit(async (git) => {
      const h = await hostingOf(git);
      if (h) await openInBrowser(mergeRequestsUrl(h));
    }),
  );

  // ---- Branches and tags ----------------------------------------------------------------------

  const openRef = withGit(async (git, arg?: RefArg) => {
    const ref = await refOrCurrent(git, arg);
    if (!ref) return;
    if (ref.refKind === "tag") {
      const h = await hostingOf(git);
      if (h) await openInBrowser(tagUrl(h, ref.refName!));
      return;
    }
    const target = await remoteBranch(git, ref);
    if (!target) return;
    const { h, branch, pushed } = target;
    if (
      !pushed &&
      !(await confirmMissing(`Branch '${branch}' is not on '${h.remote}' yet.`, () =>
        vscode.commands.executeCommand("gitTool.ref.push", ref),
      ))
    )
      return;
    await openInBrowser(branchUrl(h, branch));
  });
  reg("gitTool.ref.openInBrowser", openRef);
  reg("gitTool.openBranchInBrowser", () => openRef());

  reg(
    "gitTool.ref.createMergeRequest",
    withGit(async (git, arg?: RefArg) => {
      const ref = await refOrCurrent(git, arg);
      if (!ref || ref.refKind === "tag") return;
      const target = await remoteBranch(git, ref);
      if (!target) return;
      const { h, branch, pushed } = target;
      const word = mergeRequestWord(h.provider).toLowerCase();
      if (
        !pushed &&
        !(await confirmMissing(
          `Branch '${branch}' is not on '${h.remote}' yet: push it before creating a ${word}.`,
          () => vscode.commands.executeCommand("gitTool.ref.push", ref),
        ))
      )
        return;
      await openInBrowser(newMergeRequestUrl(h, branch));
    }),
  );

  reg(
    "gitTool.ref.openMergeRequest",
    withGit(async (git, arg?: RefArg) => {
      const ref = await refOrCurrent(git, arg);
      if (!ref || ref.refKind === "tag") return;
      const target = await remoteBranch(git, ref);
      if (!target) return;
      const { h, branch } = target;
      const word = mergeRequestWord(h.provider);
      let mrs: MergeRequest[];
      try {
        mrs = await openMergeRequests(api, h, branch);
      } catch {
        // No API access (no token, Bitbucket…): the web search for the branch does the job.
        await openInBrowser(branchMergeRequestsUrl(h, branch));
        return;
      }
      if (mrs.length) return openOneOf(h, mrs, `Open ${word}s of ${branch}`);
      const create = `Create ${word}…`;
      const choice = await vscode.window.showInformationMessage(
        `No open ${word.toLowerCase()} for '${branch}'.`,
        create,
      );
      if (choice === create)
        await vscode.commands.executeCommand("gitTool.ref.createMergeRequest", ref);
    }),
  );

  // ---- Commits and files ----------------------------------------------------------------------

  /** True when the commit is on the remote, or the user wants the page anyway. */
  const pushedOrConfirmed = async (git: Git, h: Hosting, hash: string) =>
    (await isOnRemote(git, h.remote, hash)) ||
    confirmMissing(`Commit ${hash.slice(0, 8)} is not on '${h.remote}' yet.`);

  reg(
    "gitTool.log.openInBrowser",
    withGit(async (git, c?: CommitArg) => {
      if (!c?.hash) return;
      const h = await hostingOf(git);
      if (h && (await pushedOrConfirmed(git, h, c.hash))) await openInBrowser(commitUrl(h, c.hash));
    }),
  );

  reg(
    "gitTool.log.openMergeRequest",
    withGit(async (git, c?: CommitArg) => {
      if (!c?.hash) return;
      const h = await hostingOf(git);
      if (!h) return;
      const word = mergeRequestWord(h.provider);
      let mrs: MergeRequest[];
      try {
        mrs = await commitMergeRequests(api, h, c.hash);
      } catch (e) {
        const signIn = "Sign In…";
        const choice = await vscode.window.showWarningMessage(
          e instanceof Error ? e.message : String(e),
          ...(e instanceof AuthRequired ? [signIn] : []),
        );
        if (choice === signIn) await api.signIn(h);
        return;
      }
      if (!mrs.length) {
        void vscode.window.showInformationMessage(
          `No ${word.toLowerCase()} contains commit ${c.hash.slice(0, 8)}.`,
        );
        return;
      }
      await openOneOf(h, mrs, `${word}s containing ${c.hash.slice(0, 8)}`);
    }),
  );

  reg(
    "gitTool.commitFile.openInBrowser",
    withGit(async (git, f?: CommitFileArg) => {
      if (!f?.hash || !f.path) return;
      const h = await hostingOf(git);
      if (h && (await pushedOrConfirmed(git, h, f.hash)))
        await openInBrowser(fileUrl(h, f.hash, f.path));
    }),
  );

  /** Link to a working-tree file at HEAD (or its upstream branch when HEAD is not pushed). */
  const fileLink = async (uri?: vscode.Uri): Promise<string | undefined> => {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? editor?.document.uri;
    if (!target) return undefined;
    const found = repos.forFile(target);
    if (!found) return undefined;
    const { git, rel } = found;
    const h = await hostingOf(git);
    if (!h) return undefined;
    const { hash, branch } = await head(git);
    if (!hash) return undefined;
    let ref = hash;
    if (!(await isOnRemote(git, h.remote, hash))) {
      const upstream = branch && (await remoteBranch(git, { refName: branch, refKind: "head" }));
      if (upstream && upstream.pushed) ref = upstream.branch;
      else if (!(await confirmMissing(`The current commit is not on '${h.remote}' yet.`)))
        return undefined;
    }
    let lines: [number, number] | undefined;
    if (editor && editor.document.uri.toString() === target.toString()) {
      const s = editor.selection;
      const end = s.end.line > s.start.line && s.end.character === 0 ? s.end.line - 1 : s.end.line;
      lines = [s.start.line + 1, end + 1];
    }
    return fileUrl(h, ref, rel, lines);
  };
  reg("gitTool.openFileInBrowser", async (uri?: vscode.Uri) => {
    const url = await fileLink(uri instanceof vscode.Uri ? uri : undefined);
    if (url) await openInBrowser(url);
  });
  reg("gitTool.copyFileLink", async (uri?: vscode.Uri) => {
    const url = await fileLink(uri instanceof vscode.Uri ? uri : undefined);
    if (!url) return;
    await copyText(url);
    vscode.window.setStatusBarMessage("$(link) Link copied", 3000);
  });
}
