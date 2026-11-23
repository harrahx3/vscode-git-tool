// Multi-root workspace tests: folders "alpha" (1 uncommitted file, branch alpha-only) and "beta"
// (2 uncommitted files, branch beta-only), both Git repositories.
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";

const EXTENSION_ID = "harrahx3.vscode-git-tool";

interface TestApi {
  includedChanges(): Promise<string[]>;
  branchNames(): Promise<string[]>;
  worktrees(): Promise<string[]>;
  changeCountBadge(): Promise<{ value: number; tooltip: string } | undefined>;
}
let api: TestApi;

const folder = (name: string) => vscode.workspace.workspaceFolders!.find((f) => f.name === name)!;
const file = (name: string, f: string) => vscode.Uri.file(path.join(folder(name).uri.fsPath, f));

async function until<T>(
  read: () => Promise<T>,
  ok: (v: T) => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() - start > timeoutMs)
      throw new Error(`timed out waiting for ${what}; last: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
/** Branch names come back as `head:<name>` / `HEAD:<name>`. */
const has = (names: string[], branch: string) => names.some((n) => n.endsWith(`:${branch}`));
const show = (name: string, f = "a.txt") => vscode.window.showTextDocument(file(name, f));

const tests: [string, () => Promise<void>][] = [
  [
    "activates in a two-folder workspace and the built-in Git opens both repositories",
    async () => {
      assert.deepStrictEqual(
        vscode.workspace.workspaceFolders!.map((f) => f.name),
        ["alpha", "beta"],
      );
      api = await vscode.extensions.getExtension<TestApi>(EXTENSION_ID)!.activate();
      const git = vscode.extensions.getExtension("vscode.git")!.exports.getAPI(1);
      await until(
        async () => git.repositories.length,
        (n) => n === 2,
        "two repositories",
      );
    },
  ],
  [
    "the views follow the active editor: alpha's file shows alpha's branches and changes",
    async () => {
      await show("alpha");
      const names = await until(
        () => api.branchNames(),
        (n) => has(n, "alpha-only"),
        "alpha branches",
      );
      assert.ok(!has(names, "beta-only"), names.join(", "));
      const changes = await until(
        () => api.includedChanges(),
        (c) => c.length === 1,
        "alpha changes",
      );
      assert.ok(
        changes.every((c) => !c.includes("b1.txt")),
        changes.join(", "),
      );
      assert.deepStrictEqual(await api.changeCountBadge(), { value: 1, tooltip: "1 change" });
    },
  ],
  [
    "switching to a file of beta switches the views to beta",
    async () => {
      await show("beta", "b1.txt");
      const names = await until(
        () => api.branchNames(),
        (n) => has(n, "beta-only"),
        "beta branches",
      );
      assert.ok(!has(names, "alpha-only"), names.join(", "));
      const changes = await until(
        () => api.includedChanges(),
        (c) => c.length === 2,
        "beta changes",
      );
      assert.ok(
        changes.some((c) => c.includes("b1.txt")),
        changes.join(", "),
      );
      assert.deepStrictEqual(await api.changeCountBadge(), { value: 2, tooltip: "2 changes" });
    },
  ],
  [
    "switching back to alpha restores alpha's view",
    async () => {
      await show("alpha");
      await until(
        () => api.branchNames(),
        (n) => has(n, "alpha-only") && !has(n, "beta-only"),
        "alpha branches again",
      );
      await until(
        () => api.includedChanges(),
        (c) => c.length === 1,
        "alpha changes again",
      );
    },
  ],
  [
    "removing beta from the workspace leaves alpha's repository showing",
    async () => {
      vscode.workspace.updateWorkspaceFolders(1, 1);
      await until(
        async () =>
          vscode.extensions.getExtension("vscode.git")!.exports.getAPI(1).repositories.length,
        (n) => n === 1,
        "one repository left",
      );
      await until(
        () => api.branchNames(),
        (n) => has(n, "alpha-only"),
        "alpha branches after removal",
      );
    },
  ],
];

export async function run(): Promise<void> {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${(err as Error).message}`);
    }
  }
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  if (failed) throw new Error(`${failed} integration test(s) failed`);
}
