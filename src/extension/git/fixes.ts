// Fixes that need a remote, an upstream branch or local setup: update before pushing, push and
// track, recreate or stop tracking a deleted upstream, add a remote, remove a stale lock, set the
// git identity. Called by recovery.ts.
import * as fs from "fs";
import * as vscode from "vscode";
import type { Problem } from "./errors";
import { currentBranch, push, update, upstreamOf } from "./operations";
import { ask, type Actions, type Task } from "./prompt";
import { withProgress } from "./recovery";
import type { Git } from "./runner";

const updateMethod = () =>
  vscode.workspace.getConfiguration("gitTool").get<"merge" | "rebase">("updateMethod", "merge");

// ---- Remotes and upstreams --------------------------------------------------------------------

export async function pushRejected(
  title: string,
  git: Git,
  lease: Task | undefined,
  again: Task,
): Promise<boolean> {
  const method = updateMethod();
  const actions: Actions = {
    "Pull and Push": async () => (await withProgress("Pull", () => update(git, method))) && again(),
  };
  if (lease) actions["Force Push"] = () => withProgress(`Force ${title}`, lease);
  const result = await ask(
    "warning",
    `${title} rejected: the remote branch has commits that your branch does not have.`,
    actions,
    {
      detail: `Pull and Push first ${method === "rebase" ? "rebases your commits onto" : "merges"} the remote commits, then pushes.\n\nForce Push (with lease) replaces the remote branch with yours: the remote commits are lost for everyone.`,
    },
  );
  return result === true;
}

export async function noUpstream(git: Git, again: Task): Promise<boolean> {
  const branch = await currentBranch(git);
  if (!branch) return false;
  const result = await ask(
    "warning",
    `The branch ${branch} has no upstream branch.`,
    {
      "Push and Track": () => withProgress(`Push ${branch}`, () => push(git)),
      "Track Remote Branch…": async () => {
        const remotes = (
          await git.run(["for-each-ref", "--format=%(refname:short)", "refs/remotes"])
        )
          .split("\n")
          .filter((r) => r && !r.endsWith("/HEAD"));
        const picked = await vscode.window.showQuickPick(remotes, {
          title: `Track a remote branch with ${branch}`,
        });
        if (!picked) return false;
        await git.write(["branch", `--set-upstream-to=${picked}`]);
        return again();
      },
    },
    {
      detail:
        "Push and Track creates the branch on the remote and tracks it. Or pick an existing remote branch to track.",
    },
  );
  return result === true;
}

export async function upstreamGone(git: Git): Promise<boolean> {
  const branch = await currentBranch(git);
  const upstream = branch && (await upstreamOf(git, branch));
  if (!branch || !upstream) return false;
  const name = `${upstream.remote}/${upstream.branch}`;
  const result = await ask(
    "warning",
    `The upstream branch ${name} no longer exists on the remote.`,
    {
      "Push to Recreate It": () =>
        withProgress(`Push ${branch}`, () =>
          git.network(["push", "--set-upstream", upstream.remote, `${branch}:${upstream.branch}`]),
        ),
      "Stop Tracking": () =>
        withProgress("Stop tracking", () => git.write(["branch", "--unset-upstream"])),
    },
    { detail: "It was probably merged and deleted. Push to recreate it, or stop tracking it." },
  );
  return result === true;
}

export async function noRemote(git: Git, again: Task): Promise<boolean> {
  const result = await ask(
    "warning",
    "The repository has no remote.",
    {
      "Add Remote…": async () => {
        const name = await vscode.window.showInputBox({
          title: "Add Remote (1/2)",
          prompt: "Remote name",
          value: "origin",
        });
        if (!name?.trim()) return false;
        const url = await vscode.window.showInputBox({
          title: "Add Remote (2/2)",
          prompt: `URL of ${name.trim()}`,
          placeHolder: "https://host/group/repo.git or git@host:group/repo.git",
        });
        if (!url?.trim()) return false;
        await git.write(["remote", "add", name.trim(), url.trim()]);
        return again();
      },
    },
    { detail: "Add a remote to push and pull." },
  );
  return result === true;
}

// ---- Local setup -----------------------------------------------------------------------------

export async function staleLock(title: string, p: Problem, again: Task): Promise<boolean> {
  const actions: Actions = { Retry: again };
  const lock = p.lockFile;
  if (lock)
    actions["Remove Lock and Retry"] = async () => {
      fs.rmSync(lock, { force: true });
      return again();
    };
  const result = await ask(
    "warning",
    `${title}: another git process seems to be running.`,
    actions,
    {
      detail: `${lock ?? "A lock file"} exists. Wait for the other git command to finish and retry. If none is running (it crashed), remove the lock file.`,
    },
  );
  return result === true;
}

export async function setIdentity(git: Git, again: Task): Promise<boolean> {
  const get = async (key: string) =>
    (await git.run(["config", "--get", key], { okCodes: [1] })).trim();
  const result = await ask(
    "warning",
    "Git needs your name and email to create commits.",
    {
      "Set Name and Email…": async () => {
        const name = await vscode.window.showInputBox({
          title: "Git identity (1/2)",
          prompt: "Your name, as shown in commits",
          value: await get("user.name"),
        });
        if (!name?.trim()) return false;
        const email = await vscode.window.showInputBox({
          title: "Git identity (2/2)",
          prompt: "Your email, as shown in commits",
          value: await get("user.email"),
          validateInput: (v) => (/^\S+@\S+$/.test(v.trim()) ? undefined : "Enter an email"),
        });
        if (!email?.trim()) return false;
        await git.write(["config", "--global", "user.name", name.trim()]);
        await git.write(["config", "--global", "user.email", email.trim()]);
        return again();
      },
    },
    { detail: "They are saved in your global git configuration (user.name, user.email)." },
  );
  return result === true;
}
