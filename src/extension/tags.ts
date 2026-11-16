// Tags: create (annotated or lightweight, name suggested from the previous tags), push one or
// all, delete locally and on the remote. Pushing runs the repository's pre-push hook, e.g. the
// tag naming check of the KNIME repositories, whose output is shown if it refuses.
import * as vscode from "vscode";
import { refNameProblem, suggestTag } from "../shared/refNames";
import { defaultRemote } from "./git/operations";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";

/** Tag names, most recently created first. */
export async function tagNames(git: Git): Promise<string[]> {
  const out = await git.run([
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)",
    "refs/tags",
  ]);
  return out.split("\n").filter(Boolean);
}

async function remotes(git: Git): Promise<string[]> {
  return (await git.run(["remote"])).split("\n").filter(Boolean);
}

/** Asks for a name and a message, creates the tag on `target`, then offers to push it. */
export async function newTag(git: Git, target: string, label: string): Promise<boolean> {
  const existing = await tagNames(git);
  const title = `New Tag on ${label}`;
  const name = (
    await vscode.window.showInputBox({
      title: `${title} (1/2)`,
      prompt: "Tag name",
      value: suggestTag(existing, new Date()),
      validateInput: (v) => refNameProblem(v, existing, "tag"),
    })
  )?.trim();
  if (!name) return false;
  const message = await vscode.window.showInputBox({
    title: `${title} (2/2)`,
    prompt: "Message of an annotated tag (recommended for releases). Empty: a lightweight tag.",
    value: name,
  });
  if (message === undefined) return false;
  const args = message.trim()
    ? ["tag", "-a", name, "-m", message.trim(), target]
    : ["tag", name, target];
  if (!(await withProgress(`Tag ${name}`, () => git.write(args)))) return false;
  const remoteList = await remotes(git);
  if (!remoteList.length) {
    vscode.window.setStatusBarMessage(`$(tag) Created tag ${name}`, 4000);
    return true;
  }
  const remote = remoteList.includes("origin") ? "origin" : remoteList[0];
  const push = await vscode.window.showInformationMessage(
    `Tag ${name} created on ${label}.`,
    `Push to ${remote}`,
  );
  if (push) await pushTag(git, name, remote);
  return true;
}

export async function pushTag(git: Git, name: string, remote?: string): Promise<boolean> {
  const to = remote ?? (await defaultRemote(git));
  return withProgress(`Push tag ${name}`, () =>
    git.network(["push", to, `refs/tags/${name}:refs/tags/${name}`]),
  );
}

export async function pushAllTags(git: Git): Promise<boolean> {
  const remote = await defaultRemote(git);
  return withProgress(`Push tags to ${remote}`, () => git.write(["push", remote, "--tags"]));
}

/** Deletes a tag here, and on the remote if the user asks. */
export async function deleteTag(git: Git, name: string): Promise<boolean> {
  const remoteList = await remotes(git);
  const remote = remoteList.includes("origin") ? "origin" : remoteList[0];
  const both = remote ? `Delete Here and on ${remote}` : undefined;
  const choice = await vscode.window.showWarningMessage(
    `Delete tag ${name}?`,
    {
      modal: true,
      detail: remote
        ? `Deleting it on ${remote} removes it for everyone (a release pipeline may rely on it).`
        : undefined,
    },
    "Delete Here",
    ...(both ? [both] : []),
  );
  if (!choice) return false;
  if (!(await withProgress(`Delete tag ${name}`, () => git.write(["tag", "-d", name]))))
    return false;
  if (choice === both && remote)
    return withProgress(`Delete tag ${name} on ${remote}`, () =>
      git.network(["push", "--delete", remote, `refs/tags/${name}`]),
    );
  return true;
}
