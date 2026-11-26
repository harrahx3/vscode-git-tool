// Branches popup (PyCharm's branch widget) and the branch actions shared with the Log's menus.
import * as vscode from "vscode";
import { refNameProblem } from "../shared/refNames";
import type { Ref, RefKind } from "../shared/types";
import { head, refs } from "./git/queries";
import { fastForwardBranches } from "./fastForward";
import type { Git } from "./git/runner";
import { withProgress } from "./git/ui";
import type { LogView } from "./logView";
import { deleteTag } from "./tags";

export interface BranchRef {
  name: string;
  kind: RefKind;
}

const remoteParts = (name: string) => {
  const slash = name.indexOf("/");
  return { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
};

async function askBranchName(git: Git, prompt: string, value = ""): Promise<string | undefined> {
  const existing = (await refs(git)).filter((r) => r.kind === "head").map((r) => r.name);
  return vscode.window.showInputBox({
    prompt,
    value,
    validateInput: (v) =>
      v.trim() === value && value ? undefined : refNameProblem(v, existing, "branch"),
  });
}

export async function checkout(git: Git, ref: BranchRef): Promise<boolean> {
  if (ref.kind === "remote") {
    const { branch } = remoteParts(ref.name);
    const local = (await refs(git)).find((r) => r.kind === "head" && r.name === branch);
    if (local) {
      const choice = await vscode.window.showWarningMessage(
        `A local branch '${branch}' already exists.`,
        { modal: true },
        "Check Out Local Branch",
        "Reset Local to Remote and Check Out",
      );
      if (!choice) return false;
      const args =
        choice === "Check Out Local Branch"
          ? ["switch", branch]
          : ["switch", "-C", branch, "--track", ref.name];
      return withProgress(`Checkout ${branch}`, () => git.write(args));
    }
    return withProgress(`Checkout ${ref.name}`, () => git.write(["switch", "--track", ref.name]));
  }
  if (ref.kind === "tag")
    return withProgress(`Checkout ${ref.name}`, () => git.write(["switch", "--detach", ref.name]));
  return withProgress(`Checkout ${ref.name}`, () => git.write(["switch", ref.name]));
}

export async function newBranchFrom(git: Git, from: string, label = from): Promise<boolean> {
  const name = await askBranchName(git, `New branch from ${label}`);
  if (!name) return false;
  return withProgress(`New branch ${name}`, () => git.write(["switch", "-c", name.trim(), from]));
}

export async function merge(git: Git, ref: string, current?: string): Promise<boolean> {
  return withProgress(`Merge ${ref} into ${current ?? "HEAD"}`, () =>
    git.write(["merge", "--no-edit", ref]),
  );
}

export async function rebaseOnto(git: Git, ref: string, current?: string): Promise<boolean> {
  return withProgress(`Rebase ${current ?? "HEAD"} onto ${ref}`, () => git.write(["rebase", ref]));
}

export async function pushBranch(git: Git, name: string, upstream?: string): Promise<boolean> {
  const remotes = (await git.run(["remote"])).split("\n").filter(Boolean);
  if (!remotes.length) {
    void vscode.window.showErrorMessage("The repository has no remote.");
    return false;
  }
  if (upstream) {
    const { remote, branch } = remoteParts(upstream);
    return withProgress(`Push ${name}`, () => git.network(["push", remote, `${name}:${branch}`]));
  }
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  return withProgress(`Push ${name}`, () => git.network(["push", "--set-upstream", remote, name]));
}

export async function rename(git: Git, name: string): Promise<boolean> {
  const to = await askBranchName(git, `Rename branch ${name}`, name);
  if (!to || to === name) return false;
  return withProgress(`Rename ${name}`, () => git.write(["branch", "-m", name, to.trim()]));
}

export async function deleteRef(git: Git, ref: BranchRef): Promise<boolean> {
  if (ref.kind === "tag") return deleteTag(git, ref.name);
  if (ref.kind === "remote") {
    const { remote, branch } = remoteParts(ref.name);
    const ok = await vscode.window.showWarningMessage(
      `Delete branch ${branch} on remote ${remote}?`,
      { modal: true, detail: "This changes the remote repository for everyone." },
      "Delete",
    );
    return (
      !!ok &&
      withProgress(`Delete ${ref.name}`, () => git.network(["push", "--delete", remote, branch]))
    );
  }
  try {
    await git.write(["branch", "-d", ref.name]);
    vscode.window.setStatusBarMessage(`$(trash) Deleted branch ${ref.name}`, 4000);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/not fully merged/.test(message)) {
      void vscode.window.showErrorMessage(`Delete ${ref.name} failed: ${message}`);
      return false;
    }
    const force = await vscode.window.showWarningMessage(
      `Branch ${ref.name} is not fully merged.`,
      { modal: true, detail: "Its unmerged commits will only remain reachable from the reflog." },
      "Delete Anyway",
    );
    return (
      !!force && withProgress(`Delete ${ref.name}`, () => git.write(["branch", "-D", ref.name]))
    );
  }
}

interface ActionItem extends vscode.QuickPickItem {
  run?: () => PromiseLike<unknown>;
}

/** Actions offered for one branch, in PyCharm's order. */
export function branchActions(
  git: Git,
  ref: Ref,
  current: string | undefined,
  log: LogView,
): ActionItem[] {
  const isCurrent = ref.kind === "head" && ref.name === current;
  const items: ActionItem[] = [];
  if (!isCurrent) items.push({ label: "$(check) Checkout", run: () => checkout(git, ref) });
  if (!isCurrent && ref.kind === "head" && ref.upstream)
    items.push({
      label: "$(arrow-down) Update (Fast-Forward)",
      detail: `Fetch and fast-forward to ${ref.upstream} without checking it out`,
      run: () => fastForwardBranches(git, [ref.name]),
    });
  items.push({
    label: `$(git-branch-create) New Branch from '${ref.name}'…`,
    run: () => newBranchFrom(git, ref.name),
  });
  if (!isCurrent && current) {
    items.push(
      {
        label: `$(git-compare) Compare with '${current}'`,
        detail: "Commits on each side and the files that differ",
        run: () => vscode.commands.executeCommand("gitTool.compareBranches", current, ref.name),
      },
      {
        label: `$(git-pull-request) Rebase '${current}' onto '${ref.name}'`,
        run: () => rebaseOnto(git, ref.name, current),
      },
      {
        label: `$(git-merge) Merge '${ref.name}' into '${current}'`,
        run: () => merge(git, ref.name, current),
      },
    );
  }
  items.push(
    {
      label: "$(git-compare) Compare with…",
      run: () => vscode.commands.executeCommand("gitTool.compareBranches", ref.name),
    },
    { label: "$(list-unordered) Show Log", run: () => log.show({ branch: ref.name }) },
  );
  if (ref.kind === "head") {
    items.push(
      { label: "$(repo-push) Push…", run: () => pushBranch(git, ref.name, ref.upstream) },
      { label: "$(edit) Rename…", run: () => rename(git, ref.name) },
    );
  }
  if (!isCurrent) items.push({ label: "$(trash) Delete", run: () => deleteRef(git, ref) });
  return items;
}

/** The branches popup: actions on the top, then local and remote branches; pick one for its actions. */
export async function showBranchesPopup(
  git: Git,
  log: LogView,
  top: { label: string; command: string }[],
): Promise<void> {
  const [h, all] = await Promise.all([head(git), refs(git)]);
  type Item = vscode.QuickPickItem & { ref?: Ref; command?: string; run?: () => Promise<unknown> };
  const items: Item[] = [
    ...top.map((t) => ({ label: t.label, command: t.command })),
    {
      label: "$(add) New Branch…",
      run: () => newBranchFrom(git, "HEAD", h.branch ?? "HEAD"),
    },
    {
      label: "$(tag) Checkout Tag or Revision…",
      run: async () => {
        const rev = await vscode.window.showInputBox({ prompt: "Tag, commit hash or revision" });
        if (rev)
          await withProgress(`Checkout ${rev}`, () => git.write(["switch", "--detach", rev]));
      },
    },
  ];
  const section = (title: string, kind: RefKind) => {
    const list = all.filter((r) => r.kind === kind);
    if (!list.length) return;
    items.push({ label: title, kind: vscode.QuickPickItemKind.Separator });
    for (const ref of list) {
      const track = [ref.ahead ? `↑${ref.ahead}` : "", ref.behind ? `↓${ref.behind}` : ""]
        .filter(Boolean)
        .join(" ");
      const isCurrent = kind === "head" && ref.name === h.branch;
      items.push({
        label: `${isCurrent ? "$(check)" : kind === "tag" ? "$(tag)" : "$(git-branch)"} ${ref.name}`,
        description: [ref.upstream, track].filter(Boolean).join("  "),
        ref,
      });
    }
  };
  section("Local", "head");
  section("Remote", "remote");
  const picked = await vscode.window.showQuickPick(items, {
    title: `Branches — current: ${h.branch ?? `detached at ${h.hash?.slice(0, 8) ?? "?"}`}`,
    placeHolder: "Search branches and actions",
    matchOnDescription: true,
  });
  if (!picked) return;
  if (picked.command) return void vscode.commands.executeCommand(picked.command);
  if (picked.run) return void (await picked.run());
  if (!picked.ref) return;
  const actions = branchActions(git, picked.ref, h.branch, log);
  const action = await vscode.window.showQuickPick(actions, { title: picked.ref.name });
  await action?.run?.();
}

/** Deletes several branches and tags after one confirmation (the current branch is skipped). */
export async function deleteRefs(git: Git, list: BranchRef[], current?: string): Promise<boolean> {
  const targets = list.filter((r) => !(r.kind === "head" && r.name === current));
  if (!targets.length) {
    void vscode.window.showInformationMessage("The current branch cannot be deleted.");
    return false;
  }
  const tags = targets.filter((r) => r.kind === "tag").map((r) => r.name);
  const locals = targets.filter((r) => r.kind === "head").map((r) => r.name);
  const remotes = new Map<string, string[]>();
  for (const r of targets.filter((x) => x.kind === "remote")) {
    const { remote, branch } = remoteParts(r.name);
    remotes.set(remote, [...(remotes.get(remote) ?? []), branch]);
  }
  const noun = !tags.length ? "branches" : tags.length === targets.length ? "tags" : "refs";
  const lines = targets.map((r) =>
    r.kind === "tag" ? `tag ${r.name}` : r.kind === "remote" ? `${r.name} (remote)` : r.name,
  );
  const notes = [
    remotes.size ? "Remote branches are deleted for everyone." : "",
    targets.length < list.length ? `The current branch ${current} is kept.` : "",
  ].filter(Boolean);
  const ok = await vscode.window.showWarningMessage(
    `Delete ${targets.length} ${noun}?`,
    { modal: true, detail: [lines.join("\n"), ...notes].join("\n\n") },
    "Delete",
  );
  if (!ok) return false;
  const unmerged: string[] = [];
  const done = await withProgress(`Delete ${targets.length} ${noun}`, async () => {
    if (tags.length) await git.write(["tag", "-d", ...tags]);
    for (const [remote, branches] of remotes)
      for (const branch of branches) await git.network(["push", "--delete", remote, branch]);
    for (const name of locals) {
      try {
        await git.write(["branch", "-d", name]);
      } catch (e) {
        if (!/not fully merged/.test(e instanceof Error ? e.message : String(e))) throw e;
        unmerged.push(name);
      }
    }
  });
  if (!done || !unmerged.length) return done;
  const force = await vscode.window.showWarningMessage(
    unmerged.length === 1
      ? `Branch ${unmerged[0]} is not fully merged.`
      : `${unmerged.length} branches are not fully merged.`,
    {
      modal: true,
      detail: `${unmerged.join("\n")}\n\nTheir unmerged commits will only remain reachable from the reflog.`,
    },
    "Delete Anyway",
  );
  return (
    !!force &&
    withProgress(`Delete ${unmerged.length} branches`, () =>
      git.write(["branch", "-D", ...unmerged]),
    )
  );
}
