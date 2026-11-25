// What to do when a git operation fails: recognise the problem (errors.ts) and offer the way
// out — stash and retry, resolve or abort conflicts, sign in again, update before pushing, set
// an upstream, add a remote, remove a stale lock… Problems that block what the user asked for
// get a modal dialog whose outcome is returned; the others a notification with buttons.
import * as vscode from "vscode";
import { resolveConflicts } from "./conflicts";
import { classify, errorText, remoteMessages, type Problem, type ProblemKind } from "./errors";
import { askHookConfirmation, hookExists, showHookFailure } from "./hookReport";
import { CONFIRMED_ENV, hookConfirmation, hookOf } from "./hooks";
import {
  OPERATION_LABEL,
  abortOperation,
  conflictedFiles,
  currentOperation,
  skipCommit,
  stashChanges,
  unstashChanges,
} from "./operations";
import { getHost, outputChannel } from "./output";
import { ask, type Actions, type Task } from "./prompt";
import { noRemote, noUpstream, pushRejected, setIdentity, staleLock, upstreamGone } from "./fixes";
import { GitError, type Git } from "./runner";
import { checkedOutAt } from "../../shared/worktrees";

/**
 * Runs an operation with a progress notification. On failure, offers the fix that fits the
 * problem. Returns true when the operation (or its retry) succeeded.
 */
export async function withProgress(title: string, fn: Task): Promise<boolean> {
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, fn);
    return true;
  } catch (e) {
    return recover(title, e, fn);
  }
}

const showLog = () => outputChannel().show();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Runs again the command that failed, with `extra` after its subcommand. */
function rerun(e: unknown, extra: string[] = [], before: string[] = []): Task | undefined {
  if (!(e instanceof GitError) || !e.git || !e.args) return undefined;
  const { git, args, input } = e;
  const full = [...before, args[0], ...extra, ...args.slice(1)];
  return ["fetch", "push"].includes(args[0]) && !before.length
    ? () => git.network(full)
    : () => git.write(full, input);
}

/** Runs `retry` with the hook confirmation; a hook that still asks does not read it. */
async function confirmedRetry(git: Git, hook: string, retry: Task): Promise<void> {
  try {
    await git.withHooksConfirmed(retry);
  } catch (e) {
    if (!hookConfirmation(errorText(e))) throw e;
    throw new Error(
      `the ${hook} hook asked again although ${CONFIRMED_ENV}=1 was set: it does not read that variable. Run the command in a terminal to answer it.`,
      { cause: e },
    );
  }
}

function shellQuote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

/** Runs the failed command in a terminal, where git can ask for credentials or a host key. */
function runInTerminal(git: Git, args: string[]): void {
  const terminal = vscode.window.createTerminal({ name: "Git", cwd: git.root });
  terminal.show();
  terminal.sendText(`git ${args.map(shellQuote).join(" ")}`);
}

/** Offers what fits the problem. Returns true when a retry made the operation succeed. */
export async function recover(title: string, e: unknown, retry: Task): Promise<boolean> {
  const text = errorText(e);
  const p = classify(text);
  const git = (e instanceof GitError && e.git) || getHost().currentGit();
  outputChannel().appendLine(`${title} failed (${p.kind}): ${p.summary}`);
  if (!git) {
    void ask("error", `${title} failed: ${p.summary}`, { "Show Log": showLog });
    return false;
  }
  const again = () => withProgress(title, retry);
  const args = e instanceof GitError ? e.args : undefined;
  const hook = args && hookOf(args);
  const confirmation = hook && args ? hookConfirmation(text) : undefined;
  if (hook && args && confirmation)
    return askHookConfirmation(title, hook, args, confirmation, () =>
      withProgress(title, () => confirmedRetry(git, hook, retry)),
    );
  if (hook && args && (await isHookFailure(git, hook, p.kind, text))) {
    void showHookFailure(title, git, hook, args, text, again, () =>
      withProgress(title, () => git.withoutHooks(retry)),
    );
    return false;
  }
  switch (p.kind) {
    case "localChanges":
    case "untrackedOverwritten":
      return smartRetry(title, git, p, e, retry);
    case "conflict":
      void conflictNotice(title, git);
      return false;
    case "operationInProgress":
      void inProgressNotice(git);
      return false;
    case "auth": {
      const where = /(https?:\/\/[^/'\s]+|[\w.-]+@[\w.-]+)/.exec(text)?.[1];
      const actions: Actions = { Retry: again };
      if (args) actions["Run in Terminal"] = () => runInTerminal(git, args);
      actions["Show Log"] = showLog;
      void ask("error", `${title}: authentication failed${where ? ` for ${where}` : ""}.`, actions);
      return false;
    }
    case "hostKey": {
      const actions: Actions = {};
      if (args) actions["Run in Terminal"] = () => runInTerminal(git, args);
      actions["Show Log"] = showLog;
      void ask(
        "error",
        `${title}: the remote's SSH host key is not trusted. Run the command in a terminal to check and accept it.`,
        actions,
      );
      return false;
    }
    case "network":
      void ask("error", `${title}: could not reach the remote (${p.summary}).`, {
        Retry: again,
        "Show Log": showLog,
      });
      return false;
    case "pushRejected":
      return pushRejected(title, git, rerun(e, ["--force-with-lease"]), again);
    case "staleLease":
      void ask(
        "warning",
        `${title}: force push refused, the remote branch changed since your last fetch. Fetch and look at the new commits first.`,
        { Fetch: () => withProgress("Fetch", () => git.network(["fetch", "--all", "--prune"])) },
      );
      return false;
    case "remoteRejected": {
      const why = remoteMessages(text).slice(0, 2).join(" ") || p.summary;
      void ask("error", `${title}: the remote refused it. ${why}`, { "Show Log": showLog });
      return false;
    }
    case "noUpstream":
      return noUpstream(git, again);
    case "upstreamGone":
      return upstreamGone(git);
    case "detachedHead":
      void ask("warning", `${title}: HEAD is detached, you are not on a branch.`, {
        "New Branch Here…": () => vscode.commands.executeCommand("gitTool.newBranch"),
        "Checkout Branch…": () => vscode.commands.executeCommand("gitTool.checkout"),
      });
      return false;
    case "noRemote":
      return noRemote(git, again);
    case "lock":
      return staleLock(title, p, again);
    case "identity":
      return setIdentity(git, again);
    case "signing": {
      const unsigned = rerun(e, [], ["-c", "commit.gpgsign=false"]);
      const actions: Actions = {};
      if (unsigned) actions["Retry Without Signing"] = () => withProgress(title, unsigned);
      actions["Show Log"] = showLog;
      void ask("error", `${title}: signing the commit failed (${p.summary}).`, actions);
      return false;
    }
    case "emptyCommit":
      void emptyCommit(title, git);
      return false;
    case "nothingToCommit":
      void vscode.window.showInformationMessage(`${title}: nothing to commit.`);
      return false;
    case "unrelatedHistories": {
      const anyway = rerun(e, ["--allow-unrelated-histories"]);
      if (!anyway) break;
      const ok = await ask(
        "warning",
        "The branches have no common history.",
        { "Merge Anyway": () => withProgress(title, anyway) },
        { detail: "Merging them joins two unrelated histories into one." },
      );
      return ok === true;
    }
    case "branchExists": {
      const name = /named '([^']+)'/.exec(text)?.[1];
      const actions: Actions = {};
      if (name)
        actions["Check It Out"] = () =>
          withProgress(`Checkout ${name}`, () => git.write(["switch", name]));
      void ask("error", p.summary, actions);
      return false;
    }
    case "checkedOutElsewhere": {
      const where = checkedOutAt(text);
      const actions: Actions = {};
      if (where) {
        const open = (forceNewWindow: boolean) => () =>
          vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(where), {
            forceNewWindow,
            forceReuseWindow: !forceNewWindow,
          });
        actions["Open That Worktree"] = open(false);
        actions["Open in New Window"] = open(true);
      }
      void ask("error", `${title} failed: ${p.summary}`, actions);
      return false;
    }
    case "hookFailed":
      void ask("error", `${title}: a git hook failed (${p.summary}).`, { "Show Log": showLog });
      return false;
    default:
      break;
  }
  void ask("error", `${title} failed: ${p.summary}`, { "Show Log": showLog });
  return false;
}

/** Problems git reports itself: a failing hook is not the cause. */
const GIT_OWN = new Set<ProblemKind>([
  "identity",
  "signing",
  "lock",
  "nothingToCommit",
  "operationInProgress",
  "emptyCommit",
  "auth",
  "hostKey",
  "network",
  "noRemote",
  "staleLease",
  "noUpstream",
  "upstreamGone",
  "detachedHead",
  "pushRejected",
  "remoteRejected",
  "unrelatedHistories",
  "localChanges",
  "untrackedOverwritten",
]);

/** A hook stopped the command: it is installed and git did not report a problem of its own. */
async function isHookFailure(
  git: Git,
  hook: string,
  kind: ProblemKind,
  text: string,
): Promise<boolean> {
  if (GIT_OWN.has(kind)) return false;
  // A pre-push hook that fails makes git say only this.
  if (hook === "pre-push" && !/failed to push some refs/.test(text)) return false;
  return hookExists(git, hook);
}

// ---- Local changes in the way: stash, retry, unstash ----------------------------------------

async function smartRetry(
  title: string,
  git: Git,
  p: Problem,
  e: unknown,
  retry: Task,
): Promise<boolean> {
  const files = p.files.length
    ? p.files.slice(0, 8).join("\n") +
      (p.files.length > 8 ? `\n…and ${p.files.length - 8} more` : "")
    : "";
  const untracked = p.kind === "untrackedOverwritten";
  const isCheckout = e instanceof GitError && ["switch", "checkout"].includes(e.args?.[0] ?? "");
  const actions: Actions = {
    "Stash and Retry": () => stashAndRetry(title, git, retry),
  };
  const force = isCheckout && !untracked ? rerun(e, ["--discard-changes"]) : undefined;
  if (force) actions["Force Checkout"] = () => withProgress(title, force);
  const result = await ask(
    "warning",
    `${title}: your ${untracked ? "untracked files" : "local changes"} would be overwritten.`,
    actions,
    {
      detail: [
        files,
        "Stash and Retry puts your changes aside, runs the operation, then re-applies them.",
        force ? "Force Checkout discards all your local changes." : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  );
  return result === true;
}

async function stashAndRetry(title: string, git: Git, retry: Task): Promise<boolean> {
  let stashed: boolean;
  try {
    stashed = await stashChanges(git, `Git Changelists & Log: before ${title}`);
  } catch (e) {
    return recover("Stash", e, () => stashChanges(git, `Git Changelists & Log: before ${title}`));
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title },
      retry,
    );
  } catch (e) {
    const p = classify(errorText(e));
    if (p.kind === "conflict") {
      void conflictNotice(title, git, stashed);
      return false;
    }
    if (stashed) await unstashChanges(git).catch(() => undefined);
    void ask("error", `${title} failed: ${p.summary}`, { "Show Log": showLog });
    return false;
  }
  if (stashed)
    try {
      await unstashChanges(git);
    } catch {
      void conflictNotice("Re-applying your local changes", git, true);
    }
  return true;
}

// ---- Conflicts and unfinished operations ------------------------------------------------------

async function conflictNotice(title: string, git: Git, stashKept = false): Promise<void> {
  const [op, files] = await Promise.all([currentOperation(git), conflictedFiles(git)]);
  const actions: Actions = { "Resolve Conflicts": () => resolveConflicts(git) };
  if (op)
    actions[`Abort ${OPERATION_LABEL[op]}`] = () =>
      withProgress(`Abort ${OPERATION_LABEL[op]}`, () => abortOperation(git, op));
  const kept = stashKept
    ? " Your local changes are kept in the stash: Unstash them once you are done."
    : "";
  await ask(
    "warning",
    `${title} stopped on conflicts in ${plural(files.length, "file")}.${kept}`,
    actions,
  );
}

async function inProgressNotice(git: Git): Promise<void> {
  const [op, files] = await Promise.all([currentOperation(git), conflictedFiles(git)]);
  if (!op) return conflictNotice("The previous operation", git);
  const label = OPERATION_LABEL[op];
  const actions: Actions = files.length
    ? { "Resolve Conflicts": () => resolveConflicts(git) }
    : { [`Continue ${label}`]: () => vscode.commands.executeCommand("gitTool.operation.continue") };
  actions[`Abort ${label}`] = () => withProgress(`Abort ${label}`, () => abortOperation(git, op));
  await ask(
    "warning",
    `A ${label.toLowerCase()} is in progress${files.length ? ` with ${plural(files.length, "conflicted file")}` : ""}: finish or abort it first.`,
    actions,
  );
}

async function emptyCommit(title: string, git: Git): Promise<void> {
  const op = await currentOperation(git);
  if (!op || op === "merge") {
    void vscode.window.showInformationMessage(`${title}: nothing to commit.`);
    return;
  }
  const label = OPERATION_LABEL[op];
  await ask("warning", `${title}: this commit brings no change (it is already applied).`, {
    "Skip It": () => withProgress(`Skip commit`, () => skipCommit(git, op)),
    [`Abort ${label}`]: () => withProgress(`Abort ${label}`, () => abortOperation(git, op)),
  });
}
