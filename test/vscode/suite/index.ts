// Integration tests, run inside a real VS Code instance by runTest.ts.
import * as assert from "assert";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "harrahx3.vscode-git-tool";

interface TestApi {
  isAnnotated(uri: vscode.Uri): boolean;
  includedChanges(): Promise<string[]>;
  branchNames(): Promise<string[]>;
  comparison(): { onlyLeft: string[]; onlyRight: string[]; files: string[] } | undefined;
  isBusy(): boolean;
  changesInfo(): Promise<{ operation?: string; conflicts: number }>;
  captureBrowser(): string[];
  mergeRequests(): Promise<{ message?: string; mergeRequests: string[] }>;
  issues(): Promise<{ message?: string; issues: string[] }>;
  worktrees(): Promise<string[]>;
  commitViewStatus(): { files: string[]; notice?: string } | undefined;
  changeCountBadge(): Promise<{ value: number; tooltip: string } | undefined>;
}

async function waitFor(
  check: () => boolean,
  what: string,
  timeoutMs = 15_000,
  pollMs = 100,
): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

const repo = () => vscode.workspace.workspaceFolders![0].uri.fsPath;
const file = (name: string) => vscode.Uri.file(path.join(repo(), name));
let api: TestApi;
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo(), encoding: "utf8" }).trim();

type Answer = (message: string, ...rest: unknown[]) => unknown;
type Dialog = "showWarningMessage" | "showInformationMessage" | "showErrorMessage" | "showInputBox";

/**
 * Runs `fn` with dialogs answered by the given functions (no dialog in a test); every message
 * shown is recorded in `shown`.
 */
async function answering(
  answers: Partial<Record<Dialog, Answer>>,
  fn: () => PromiseLike<unknown>,
  shown: string[] = [],
): Promise<string[]> {
  const w = vscode.window as unknown as Record<Dialog, unknown>;
  const saved = new Map<Dialog, unknown>();
  for (const name of [
    "showWarningMessage",
    "showInformationMessage",
    "showErrorMessage",
    "showInputBox",
  ] as Dialog[]) {
    saved.set(name, w[name]);
    w[name] = async (first: unknown, ...rest: unknown[]) => {
      const text = typeof first === "string" ? first : ((first as { title?: string })?.title ?? "");
      shown.push(text);
      return answers[name]?.(text, first, ...rest);
    };
  }
  try {
    await fn();
  } finally {
    for (const [name, original] of saved) w[name] = original;
  }
  return shown;
}

const fileText = (name: string) => fs.readFileSync(path.join(repo(), name), "utf8");
const writeFile = (name: string, text: string) => fs.writeFileSync(path.join(repo(), name), text);
const gitDir = () => path.join(repo(), ".git");
const lines = (n: number, change: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${i + 1}`).join("\n") + "\n";

/** Runs `fn` with modal warnings answered by `answer` (no dialog in a test). */
async function answeringWarnings(answer: string, fn: () => PromiseLike<unknown>): Promise<void> {
  const warn = vscode.window.showWarningMessage;
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () => answer;
  try {
    await fn();
  } finally {
    (vscode.window as { showWarningMessage: unknown }).showWarningMessage = warn;
  }
}

const tests: [string, () => Promise<void>][] = [
  [
    "activates and registers every contributed command",
    async () => {
      const ext = vscode.extensions.getExtension<TestApi>(EXTENSION_ID)!;
      api = await ext.activate();
      const declared = (ext.packageJSON.contributes.commands as { command: string }[]).map(
        (c) => c.command,
      );
      const registered = new Set(await vscode.commands.getCommands(true));
      const missing = declared.filter((c) => !registered.has(c));
      assert.deepStrictEqual(missing, []);
    },
  ],
  [
    "the activity-bar badge counts the changes before the Commit view is ever shown",
    async () => {
      // Right after activation the Commit view was never shown, so a badge on that webview view
      // would not exist. a.txt is the only change (see runTest.ts).
      assert.strictEqual(api.commitViewStatus(), undefined);
      assert.deepStrictEqual(await api.changeCountBadge(), { value: 1, tooltip: "1 change" });
    },
  ],
  [
    "a file at a revision opens through the git-tool: scheme",
    async () => {
      const { revisionUri } = await import("../../../src/extension/revisions");
      const doc = await vscode.workspace.openTextDocument(revisionUri(repo(), "HEAD~1", "a.txt"));
      // HEAD~1 is "first commit" (first parent of the merge).
      assert.strictEqual(doc.getText(), "one\ntwo\nthree\n");
      const empty = await vscode.workspace.openTextDocument(revisionUri(repo(), "", "a.txt"));
      assert.strictEqual(empty.getText(), "");
    },
  ],
  [
    "Annotate toggles blame decorations on the active editor",
    async () => {
      const uri = file("a.txt");
      await vscode.window.showTextDocument(uri);
      await vscode.commands.executeCommand("gitTool.annotate");
      assert.strictEqual(api.isAnnotated(uri), true);
      await vscode.commands.executeCommand("gitTool.closeAnnotations");
      assert.strictEqual(api.isAnnotated(uri), false);
    },
  ],
  [
    "the Log and Commit views open, history commands run",
    async () => {
      await vscode.commands.executeCommand("gitTool.showLog");
      await vscode.commands.executeCommand("gitTool.showFileHistory", file("a.txt"));
      await vscode.commands.executeCommand("gitTool.commit");
      const editor = await vscode.window.showTextDocument(file("a.txt"));
      editor.selection = new vscode.Selection(1, 0, 1, 5);
      await vscode.commands.executeCommand("gitTool.showSelectionHistory");
    },
  ],
  [
    "the Branches view shows HEAD first, then the local branches",
    async () => {
      await vscode.commands.executeCommand("gitTool.branches.focus");
      const names = await api.branchNames();
      assert.strictEqual(names[0], "HEAD:main", names.join(", "));
      assert.ok(names.includes("head:main") && names.includes("head:feature"), names.join(", "));
    },
  ],
  [
    "git activity shows progress while the views refresh, then stops",
    async () => {
      await waitFor(() => !api.isBusy(), "git idle before the refresh");
      void api.branchNames(); // runs git
      await waitFor(() => api.isBusy(), "progress shown", 5_000, 5);
      await waitFor(() => !api.isBusy(), "progress ended", 5_000, 5);
    },
  ],
  [
    "Compare Branches shows commits on each side and the changed files",
    async () => {
      // HEAD~1 is "first commit"; feature adds "feature change" on top of it.
      await vscode.commands.executeCommand("gitTool.compareBranches", "HEAD~1", "feature");
      assert.deepStrictEqual(api.comparison(), {
        onlyLeft: [],
        onlyRight: ["feature change"],
        files: ["M a.txt"],
      });
      await vscode.commands.executeCommand("gitTool.compare.swap");
      assert.deepStrictEqual(api.comparison()?.onlyLeft, ["feature change"]);
      await vscode.commands.executeCommand("gitTool.compare.close");
      assert.strictEqual(api.comparison(), undefined);
    },
  ],
  [
    "Compare the Two Commits puts the older commit on the left",
    async () => {
      const [feature, first] = [git("rev-parse", "feature"), git("rev-parse", "HEAD~1")];
      // Newest first, as the Log table sends its selection.
      await vscode.commands.executeCommand("gitTool.log.compareCommits", {
        webviewSection: "commits",
        hashes: [feature, first],
      });
      assert.deepStrictEqual(api.comparison(), {
        onlyLeft: [],
        onlyRight: ["feature change"],
        files: ["M a.txt"],
      });
      await vscode.commands.executeCommand("gitTool.compare.close");
    },
  ],
  [
    "Compare Selected Branches and Delete Selected act on the Branches view selection",
    async () => {
      git("branch", "tmp-one", "HEAD~1");
      git("branch", "tmp-two", "feature");
      const node = (name: string) => ({ kind: "ref", refName: name, refKind: "head", leaf: name });
      const [one, two] = [node("tmp-one"), node("tmp-two")];
      await vscode.commands.executeCommand("gitTool.refs.compare", two, [one, two]);
      assert.deepStrictEqual(api.comparison()?.onlyRight, ["feature change"]);
      await vscode.commands.executeCommand("gitTool.compare.close");
      // Both are merged into main (feature was merged), so `git branch -d` deletes them.
      await answeringWarnings("Delete", () =>
        vscode.commands.executeCommand("gitTool.refs.delete", one, [one, two]),
      );
      const names = await api.branchNames();
      assert.ok(!names.includes("head:tmp-one") && !names.includes("head:tmp-two"), names.join());
      assert.ok(names.includes("head:feature"), names.join());
    },
  ],
  [
    "the Commit view lists the modified file, ticked by default",
    async () => {
      await vscode.commands.executeCommand("gitTool.commit.focus");
      assert.deepStrictEqual(await api.includedChanges(), ["a.txt"]);
      // The webview itself reports drawing the file under the message box.
      await waitFor(
        () => api.commitViewStatus()?.files.includes("a.txt") ?? false,
        "a.txt drawn in the Commit view",
      );
    },
  ],
  [
    "Rollback from the Commit view restores the file",
    async () => {
      // a.txt has an uncommitted fourth line (see runTest.ts).
      const original = fs.readFileSync(path.join(repo(), "a.txt"), "utf8");
      assert.match(original, /four/);
      await vscode.commands.executeCommand("gitTool.commit");
      // The view is resolved asynchronously; give it the status.
      await new Promise((r) => setTimeout(r, 1500));
      const warn = vscode.window.showWarningMessage;
      // Accept the modal confirmation automatically.
      (vscode.window as { showWarningMessage: unknown }).showWarningMessage = async () =>
        "Rollback";
      try {
        // The argument a right-click on the row passes (its data-vscode-context).
        await vscode.commands.executeCommand("gitTool.change.rollback", {
          webviewSection: "change",
          path: "a.txt",
          list: "Changes",
          untracked: false,
          conflict: false,
        });
      } finally {
        (vscode.window as { showWarningMessage: unknown }).showWarningMessage = warn;
      }
      await waitFor(
        () => !fs.readFileSync(path.join(repo(), "a.txt"), "utf8").includes("four"),
        "a.txt rolled back",
      );
    },
  ],
  [
    "Push goes through VS Code's Git extension and sets the upstream",
    async () => {
      const remote = path.join(repo(), "..", "remote.git");
      fs.rmSync(remote, { recursive: true, force: true });
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
      git("remote", "add", "origin", remote);
      await answering(
        { showInformationMessage: (m) => (m.startsWith("Push") ? "Push" : undefined) },
        () => vscode.commands.executeCommand("gitTool.push"),
      );
      assert.strictEqual(git("rev-parse", "--abbrev-ref", "main@{upstream}"), "origin/main");
      assert.strictEqual(
        execFileSync("git", ["rev-parse", "main"], { cwd: remote, encoding: "utf8" }).trim(),
        git("rev-parse", "main"),
      );
    },
  ],
  [
    "a failing pre-push hook: its findings go to the Problems panel",
    async () => {
      const hook = path.join(gitDir(), "hooks", "pre-push");
      fs.writeFileSync(
        hook,
        "#!/bin/sh\necho 'a.txt:2:1: E001 line two is not allowed' >&2\nexit 1\n",
        { mode: 0o755 },
      );
      git("commit", "-q", "--allow-empty", "-m", "to push");
      const shown: string[] = [];
      try {
        await answering(
          { showInformationMessage: (m) => (m.startsWith("Push") ? "Push" : undefined) },
          async () => {
            await vscode.commands.executeCommand("gitTool.push");
            await waitFor(
              () =>
                vscode.languages
                  .getDiagnostics(file("a.txt"))
                  .some((d) => d.message === "line two is not allowed"),
              "the hook's finding in the Problems panel",
            );
            await waitFor(
              () => shown.some((m) => m.includes("blocked by the pre-push hook")),
              "the hook notification",
            );
          },
          shown,
        );
      } finally {
        fs.rmSync(hook, { force: true });
      }
    },
  ],
  [
    "Checkout with local changes in the way: Stash and Retry keeps them",
    async () => {
      writeFile("c.txt", lines(12));
      git("add", "c.txt");
      git("commit", "-q", "-m", "add c.txt");
      git("switch", "-q", "-c", "side");
      writeFile("c.txt", lines(12, { 1: "line 1 (side)" }));
      git("commit", "-q", "-am", "side change");
      git("switch", "-q", "main");
      writeFile("c.txt", lines(12, { 12: "line 12 (local)" }));
      const shown = await answering(
        {
          showWarningMessage: (m) =>
            m.includes("would be overwritten") ? "Stash and Retry" : undefined,
        },
        () =>
          vscode.commands.executeCommand("gitTool.ref.checkout", {
            refName: "side",
            refKind: "head",
          }),
      );
      assert.ok(
        shown.some((m) => m.includes("would be overwritten")),
        shown.join(" | "),
      );
      assert.strictEqual(git("symbolic-ref", "--short", "HEAD"), "side");
      assert.strictEqual(
        fileText("c.txt"),
        lines(12, { 1: "line 1 (side)", 12: "line 12 (local)" }),
      );
      git("checkout", "--", "c.txt");
      git("switch", "-q", "main");
    },
  ],
  [
    "Merge conflicts: shown in the Commit view, Continue refuses markers, then finishes",
    async () => {
      git("switch", "-q", "-c", "conflicting");
      writeFile("c.txt", lines(12, { 6: "line 6 (theirs)" }));
      git("commit", "-q", "-am", "theirs");
      git("switch", "-q", "main");
      writeFile("c.txt", lines(12, { 6: "line 6 (ours)" }));
      git("commit", "-q", "-am", "ours");
      const shown: string[] = [];
      await answering(
        {},
        async () => {
          await vscode.commands.executeCommand("gitTool.ref.merge", {
            refName: "conflicting",
            refKind: "head",
          });
          await waitFor(() => shown.some((m) => m.includes("stopped on conflicts")), "notice");
        },
        shown,
      );
      assert.deepStrictEqual(await api.changesInfo(), { operation: "merge", conflicts: 1 });
      const refused = await answering({}, () =>
        vscode.commands.executeCommand("gitTool.operation.continue"),
      );
      assert.ok(
        refused.some((m) => m.includes("conflict markers")),
        refused.join(" | "),
      );
      assert.ok(fs.existsSync(path.join(gitDir(), "MERGE_HEAD")));
      writeFile("c.txt", lines(12, { 6: "line 6 (both)" }));
      await vscode.commands.executeCommand("gitTool.operation.continue");
      assert.deepStrictEqual(await api.changesInfo(), { operation: undefined, conflicts: 0 });
      assert.strictEqual(git("rev-list", "--parents", "-n1", "HEAD").split(" ").length, 3);
    },
  ],
  [
    "New Tag suggests the next version, creates an annotated tag and pushes it",
    async () => {
      git("tag", "v1.2.3", "HEAD~1");
      let suggested = "";
      await answering(
        {
          showInputBox: (title, options) => {
            const o = options as { value?: string };
            if (title.includes("(1/2)")) suggested = o.value ?? "";
            return title.includes("(1/2)") ? o.value : "Release v1.2.4";
          },
          showInformationMessage: (m) =>
            m.startsWith("Tag v1.2.4 created") ? "Push to origin" : undefined,
        },
        () => vscode.commands.executeCommand("gitTool.newTag"),
      );
      assert.strictEqual(suggested, "v1.2.4");
      assert.strictEqual(git("cat-file", "-t", "v1.2.4"), "tag");
      assert.match(git("ls-remote", "--tags", "origin", "v1.2.4"), /refs\/tags\/v1\.2\.4/);
    },
  ],
  [
    "Open in Browser builds GitLab links for commits, branches, merge requests and files",
    async () => {
      const urls = api.captureBrowser();
      const localOrigin = git("remote", "get-url", "origin");
      const web = "https://git.example.com/group/sub/repo";
      git("remote", "set-url", "origin", "git@git.example.com:group/sub/repo.git");
      try {
        const pushed = git("rev-parse", "origin/main");
        await vscode.commands.executeCommand("gitTool.log.openInBrowser", { hash: pushed });
        assert.strictEqual(urls.pop(), `${web}/-/commit/${pushed}`);

        await vscode.commands.executeCommand("gitTool.ref.openInBrowser", {
          refName: "origin/main",
          refKind: "remote",
        });
        assert.strictEqual(urls.pop(), `${web}/-/tree/main`);

        // `feature` was never pushed: a warning offers to push or open anyway.
        const shown = await answering({ showWarningMessage: () => "Open Anyway" }, () =>
          vscode.commands.executeCommand("gitTool.ref.createMergeRequest", {
            refName: "feature",
            refKind: "head",
          }),
        );
        assert.match(shown.join("|"), /Branch 'feature' is not on 'origin' yet/);
        assert.strictEqual(
          urls.pop(),
          `${web}/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature`,
        );

        const editor = await vscode.window.showTextDocument(file("a.txt"));
        editor.selection = new vscode.Selection(1, 0, 3, 0); // lines 2-3
        await answering({ showWarningMessage: () => "Open Anyway" }, () =>
          vscode.commands.executeCommand("gitTool.openFileInBrowser"),
        );
        assert.match(
          urls.pop() ?? "",
          /^https:\/\/git\.example\.com\/group\/sub\/repo\/-\/blob\/\w+\/a\.txt#L2-3$/,
        );

        await vscode.commands.executeCommand("gitTool.issues.new");
        assert.strictEqual(urls.pop(), `${web}/-/issues/new`);
        await vscode.commands.executeCommand("gitTool.issue.openInBrowser", {
          kind: "issue",
          issue: { id: 3, url: `${web}/-/issues/3` },
        });
        assert.strictEqual(urls.pop(), `${web}/-/issues/3`);
      } finally {
        git("remote", "set-url", "origin", localOrigin);
      }
      // A local-path remote has no web host: the Merge Requests view says so.
      const view = await api.mergeRequests();
      assert.match(view.message ?? "", /not a GitLab, GitHub or Bitbucket web host/);
      const issues = await api.issues();
      assert.match(issues.message ?? "", /not a GitLab, GitHub or Bitbucket web host/);
    },
  ],
  [
    "Create Branch… on an issue suggests <number>-<title> and checks it out",
    async () => {
      const node = { kind: "issue", issue: { id: 12, title: "Fix the Login page!" } };
      let suggested = "";
      await answering(
        {
          showInputBox: (_text, options) => (suggested = (options as { value?: string }).value!),
        },
        () => vscode.commands.executeCommand("gitTool.issue.createBranch", node),
      );
      assert.strictEqual(suggested, "12-fix-the-login-page");
      assert.strictEqual(git("branch", "--show-current"), "12-fix-the-login-page");
      git("switch", "-q", "main");
      git("branch", "-q", "-D", "12-fix-the-login-page");
    },
  ],
  [
    "the Worktrees view lists, creates and deletes worktrees",
    async () => {
      const folder = path.join(path.dirname(repo()), "repo.worktrees", "feature");
      fs.rmSync(path.dirname(folder), { recursive: true, force: true });
      git("worktree", "prune");
      assert.deepStrictEqual(await api.worktrees(), ["repo:main:current"]);
      // "Check Out in New Worktree…" on the branch: the suggested folder is accepted; the
      // "Created worktree" notification is dismissed (opening it would reload the test window).
      const shown = await answering(
        { showInputBox: (_text, options) => (options as { value?: string }).value },
        () =>
          vscode.commands.executeCommand("gitTool.ref.newWorktree", {
            refName: "feature",
            refKind: "head",
          }),
      );
      assert.ok(fs.existsSync(path.join(folder, "a.txt")), shown.join("|"));
      assert.deepStrictEqual(await api.worktrees(), ["repo:main:current", "feature:feature"]);
      // Checking out the same branch here fails with an offer to open that worktree.
      const failed = await answering({}, () =>
        vscode.commands.executeCommand("gitTool.ref.checkout", {
          refName: "feature",
          refKind: "head",
        }),
      );
      assert.match(failed.join("|"), /already used by worktree|already checked out/);

      fs.writeFileSync(path.join(folder, "scratch.txt"), "untracked\n");
      const node = {
        kind: "worktree",
        worktree: { path: folder, branch: "feature", detached: false, bare: false, main: false },
        isCurrent: false,
        inWorkspace: false,
      };
      const asked = await answering(
        {
          showWarningMessage: (text) =>
            /^Delete worktree/.test(text) ? "Delete Worktree" : "Delete Anyway",
        },
        () => vscode.commands.executeCommand("gitTool.worktree.delete", node, [node]),
      );
      assert.match(asked.join("|"), /uncommitted changes or untracked files/);
      assert.ok(!fs.existsSync(folder));
      assert.deepStrictEqual(await api.worktrees(), ["repo:main:current"]);
      assert.strictEqual(git("branch", "--list", "feature"), "feature");
    },
  ],
];

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name}\n    ${e instanceof Error ? e.stack : String(e)}`);
    }
  }
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
