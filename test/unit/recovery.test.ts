// Real git failures in temporary repositories: the classifier must recognise git's own words,
// and the conflict / update / stash operations must leave the repository as documented.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classify, errorText } from "../../src/extension/git/errors";
import { hookConfirmation } from "../../src/extension/git/hooks";
import {
  abortOperation,
  conflictedFiles,
  continueOperation,
  currentOperation,
  filesWithMarkers,
  markResolved,
  push,
  stashChanges,
  unstashChanges,
  update,
} from "../../src/extension/git/operations";
import { Git, GitError } from "../../src/extension/git/runner";

let dir: string;
let remoteDir: string;
let git: Git;
const write = (f: string, text: string) => writeFileSync(join(dir, f), text);
const read = (f: string) => readFileSync(join(dir, f), "utf8");

async function init(g: Git) {
  await g.run(["init", "-q", "-b", "main"]);
  await g.run(["config", "user.name", "Test User"]);
  await g.run(["config", "user.email", "test@example.invalid"]);
  await g.run(["config", "commit.gpgsign", "false"]);
}
async function commitAll(g: Git, message: string) {
  await g.run(["add", "-A"]);
  await g.run(["commit", "-q", "-m", message]);
}
/** The problem a failing call reports. */
async function problemOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return classify(errorText(e));
  }
  throw new Error("expected a failure");
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "git-tool-"));
  remoteDir = mkdtempSync(join(tmpdir(), "git-tool-remote-"));
  git = new Git(dir, "git");
  await init(git);
  write("a.txt", "one\ntwo\nthree\n");
  await commitAll(git, "initial");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(remoteDir, { recursive: true, force: true });
});

/** A branch `other` and main both changing line two of a.txt. */
async function divergingBranches() {
  await git.run(["switch", "-q", "-c", "other"]);
  write("a.txt", "one\nOTHER\nthree\n");
  await commitAll(git, "other change");
  await git.run(["switch", "-q", "main"]);
  write("a.txt", "one\nMAIN\nthree\n");
  await commitAll(git, "main change");
}

async function withRemote() {
  await new Git(remoteDir, "git").run(["init", "-q", "--bare", "-b", "main"]);
  await git.run(["remote", "add", "origin", remoteDir]);
}

describe("git's own failures are recognised", () => {
  it("local changes that a checkout would overwrite, with the files", async () => {
    await divergingBranches();
    write("a.txt", "one\nLOCAL\nthree\n");
    const p = await problemOf(git.write(["switch", "other"]));
    expect(p.kind).toBe("localChanges");
    expect(p.files).toEqual(["a.txt"]);
    expect(p.summary).toMatch(/would be overwritten by checkout/);
  });

  it("untracked files a checkout would overwrite", async () => {
    await git.run(["switch", "-q", "-c", "other"]);
    write("new.txt", "tracked on other\n");
    await commitAll(git, "add new.txt");
    await git.run(["switch", "-q", "main"]);
    write("new.txt", "untracked here\n");
    const p = await problemOf(git.write(["switch", "other"]));
    expect(p.kind).toBe("untrackedOverwritten");
    expect(p.files).toEqual(["new.txt"]);
  });

  it("merge conflicts, then a merge in progress", async () => {
    await divergingBranches();
    expect((await problemOf(git.write(["merge", "--no-edit", "other"]))).kind).toBe("conflict");
    expect(await currentOperation(git)).toBe("merge");
    expect(await conflictedFiles(git)).toEqual(["a.txt"]);
    expect((await problemOf(git.write(["merge", "other"]))).kind).toBe("operationInProgress");
    expect((await problemOf(git.write(["commit", "-m", "x"]))).kind).toBe("operationInProgress");
  });

  it("rebase and cherry-pick conflicts", async () => {
    await divergingBranches();
    expect((await problemOf(git.write(["cherry-pick", "other"]))).kind).toBe("conflict");
    expect(await currentOperation(git)).toBe("cherry-pick");
    await abortOperation(git, "cherry-pick");
    expect((await problemOf(git.write(["rebase", "other"]))).kind).toBe("conflict");
    expect(await currentOperation(git)).toBe("rebase");
    await abortOperation(git, "rebase");
    expect(await currentOperation(git)).toBeUndefined();
  });

  it("a rejected push, unrelated histories, existing branch, nothing to commit, lock", async () => {
    await withRemote();
    await push(git);
    // Someone else pushes first.
    const otherDir = mkdtempSync(join(tmpdir(), "git-tool-other-"));
    const other = new Git(otherDir, "git");
    await other.run(["clone", "-q", remoteDir, "."]);
    await other.run(["config", "user.email", "o@example.invalid"]);
    await other.run(["config", "user.name", "Other"]);
    writeFileSync(join(otherDir, "b.txt"), "theirs\n");
    await commitAll(other, "theirs");
    await other.run(["push", "-q"]);
    write("c.txt", "mine\n");
    await commitAll(git, "mine");
    expect((await problemOf(push(git))).kind).toBe("pushRejected");
    rmSync(otherDir, { recursive: true, force: true });

    await git.run(["switch", "-q", "--orphan", "lonely"]);
    write("z.txt", "z\n");
    await commitAll(git, "lonely");
    expect((await problemOf(git.write(["merge", "main"]))).kind).toBe("unrelatedHistories");
    expect((await problemOf(git.write(["branch", "main"]))).kind).toBe("branchExists");
    expect((await problemOf(git.write(["commit", "-m", "empty"]))).kind).toBe("nothingToCommit");
    writeFileSync(join(dir, ".git", "index.lock"), "");
    const lock = await problemOf(git.write(["commit", "--allow-empty", "-m", "x"]));
    expect(lock.kind).toBe("lock");
    expect(lock.lockFile).toMatch(/index\.lock$/);
  });

  it("a missing identity", async () => {
    write("a.txt", "changed\n");
    const p = await problemOf(git.write(["-c", "user.name=", "commit", "-am", "who am i"]));
    expect(p.kind).toBe("identity");
  });
});

describe("messages of other tools", () => {
  it.each([
    ["fatal: Authentication failed for 'https://git.example.org/g/r.git/'", "auth"],
    ["fatal: could not read Username for 'https://host': terminal prompts disabled", "auth"],
    [
      "git@host: Permission denied (publickey).\nfatal: Could not read from remote repository.",
      "auth",
    ],
    ["Host key verification failed.\nfatal: Could not read from remote repository.", "hostKey"],
    ["fatal: unable to access 'https://host/r.git/': Could not resolve host: host", "network"],
    ["fatal: unable to access 'https://h/r.git/': The requested URL returned error: 403", "auth"],
    [
      "remote: GitLab: You are not allowed to push code to protected branches on this project.\n ! [remote rejected] main -> main (pre-receive hook declined)\nerror: failed to push some refs",
      "remoteRejected",
    ],
    [
      " ! [rejected]        main -> main (stale info)\nerror: failed to push some refs",
      "staleLease",
    ],
    ["error: failed to push some refs to 'origin'", "other"],
    ["fatal: couldn't find remote ref feature", "upstreamGone"],
    ["The upstream branch origin/x no longer exists on the remote.", "upstreamGone"],
    ["The current branch x has no upstream branch.", "noUpstream"],
    ["HEAD is detached: you are not currently on a branch.", "detachedHead"],
    ["The repository has no remote.", "noRemote"],
    ["error: gpg failed to sign the data\nfatal: failed to write commit object", "signing"],
    ["The previous cherry-pick is now empty, possibly due to conflict resolution.", "emptyCommit"],
    ["fatal: 'feature' is already checked out at '/w/feature'", "checkedOutElsewhere"],
    [
      "fatal: ambiguous argument 'nope': unknown revision or path not in the working tree.",
      "unknownRevision",
    ],
  ])("%s → %s", (text, kind) => {
    expect(classify(text).kind).toBe(kind);
  });

  it("summarises with the error line, not git's hints", () => {
    expect(classify("hint: blah\nerror: pathspec 'x' did not match\nhint: more").summary).toBe(
      "pathspec 'x' did not match",
    );
  });
});

describe("a hook that asks for a confirmation", () => {
  it("blocks the push with its question, then lets it through once confirmed", async () => {
    await withRemote();
    // A pre-push hook following the GIT_HOOK_CONFIRM protocol, as without a terminal.
    write(
      ".git/hooks/pre-push",
      [
        "#!/bin/sh",
        "echo 'WARNING: this push needs a second look.' >&2",
        '[ "$GIT_HOOK_CONFIRMED" = 1 ] && exit 0',
        "echo 'GIT_HOOK_CONFIRM: Push anyway?' >&2",
        "exit 1",
      ].join("\n") + "\n",
    );
    chmodSync(join(dir, ".git/hooks/pre-push"), 0o755);
    let text = "";
    try {
      await git.write(["push", "origin", "main"]);
    } catch (e) {
      text = errorText(e);
    }
    expect(hookConfirmation(text)).toEqual({
      question: "Push anyway?",
      details: "WARNING: this push needs a second look.",
    });
    await git.withHooksConfirmed(() => git.write(["push", "origin", "main"]));
    const remote = new Git(remoteDir, "git");
    expect((await remote.run(["rev-parse", "main"])).trim()).toBe(
      (await git.run(["rev-parse", "main"])).trim(),
    );
    // The confirmation does not outlive the call.
    await expect(git.write(["push", "origin", "main:other"])).rejects.toThrow(/Push anyway/);
  });
});

describe("finishing what stopped half-way", () => {
  it("refuses to continue while conflict markers remain, then continues the merge", async () => {
    await divergingBranches();
    await git.write(["merge", "--no-edit", "other"]).catch(() => undefined);
    expect(await filesWithMarkers(git)).toEqual(["a.txt"]);
    expect((await problemOf(continueOperation(git, "merge"))).kind).toBe("conflict");
    write("a.txt", "one\nMAIN and OTHER\nthree\n");
    await continueOperation(git, "merge");
    expect(await currentOperation(git)).toBeUndefined();
    const parents = (await git.run(["rev-list", "--parents", "-n1", "HEAD"])).trim().split(" ");
    expect(parents).toHaveLength(3);
  });

  it("continues a rebase without opening an editor", async () => {
    await divergingBranches();
    await git.write(["rebase", "other"]).catch(() => undefined);
    write("a.txt", "one\nREBASED\nthree\n");
    await continueOperation(git, "rebase");
    expect(await currentOperation(git)).toBeUndefined();
    expect(read("a.txt")).toBe("one\nREBASED\nthree\n");
  });

  it("stashes around an operation and reports unstash conflicts", async () => {
    write("a.txt", "one\nLOCAL\nthree\n");
    write("u.txt", "untracked\n");
    expect(await stashChanges(git, "test")).toBe(true);
    expect(existsSync(join(dir, "u.txt"))).toBe(false);
    expect(await stashChanges(git, "nothing")).toBe(false);
    write("a.txt", "one\nCOMMITTED\nthree\n");
    await commitAll(git, "conflicting");
    expect((await problemOf(unstashChanges(git))).kind).toBe("conflict");
    expect(await currentOperation(git)).toBeUndefined();
    write("a.txt", "one\nRESOLVED\nthree\n");
    await markResolved(git);
    expect(await conflictedFiles(git)).toEqual([]);
    expect(await git.run(["status", "--porcelain"])).toContain(" M a.txt");
  });
});

describe("update and push", () => {
  it("reports a missing upstream, pushes and tracks, then updates", async () => {
    expect((await problemOf(update(git, "merge"))).kind).toBe("noUpstream");
    expect((await problemOf(push(git))).kind).toBe("noRemote");
    await withRemote();
    await push(git);
    expect((await git.run(["rev-parse", "--abbrev-ref", "@{u}"])).trim()).toBe("origin/main");
    await update(git, "rebase");
    // The upstream branch is deleted on the remote.
    await git.run(["switch", "-q", "-c", "gone"]);
    await push(git);
    await git.run(["push", "-q", "origin", "--delete", "gone"]);
    expect((await problemOf(update(git, "merge"))).kind).toBe("upstreamGone");
  });

  it("keeps the failed command on the error, to run it again", async () => {
    const e = await git.write(["switch", "nope"]).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GitError);
    expect((e as GitError).args).toEqual(["switch", "nope"]);
    expect((e as GitError).git).toBe(git);
  });

  it("skips the hooks only inside withoutHooks", async () => {
    const hook = join(dir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'ERROR: refused by the hook' >&2\nexit 1\n", {
      mode: 0o755,
    });
    write("a.txt", "changed\n");
    const failure = await problemOf(git.write(["commit", "-am", "x"]));
    expect(failure.summary).toBe("ERROR: refused by the hook");
    await git.withoutHooks(() => git.write(["commit", "-am", "x"]));
    expect((await git.run(["log", "-1", "--format=%s"])).trim()).toBe("x");
  });
});
