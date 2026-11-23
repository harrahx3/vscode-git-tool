// Integration tests against a multi-root workspace of two Git repositories, run in a real VS Code.
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

function inheritedVsCodeVariables(): string[] {
  return Object.keys(process.env).filter(
    (k) => k === "ELECTRON_RUN_AS_NODE" || k.startsWith("VSCODE_"),
  );
}

/** A repository with a `main` and an `<name>-only` branch and the given uncommitted files. */
function makeRepo(dir: string, name: string, changed: string[]): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  for (const f of changed) fs.writeFileSync(path.join(dir, f), "one\ntwo\n");
  git("add", "-A");
  git("commit", "-q", "-m", `${name} first commit`);
  git("branch", `${name}-only`);
  for (const f of changed) fs.writeFileSync(path.join(dir, f), `${name} change\n`);
}

async function main(): Promise<void> {
  const cleanEnv: Record<string, undefined> = {};
  for (const key of inheritedVsCodeVariables()) cleanEnv[key] = undefined;
  const root = path.resolve(__dirname, "../../..");
  const base = path.join(root, "out", "fixtures-multiroot");
  fs.rmSync(base, { recursive: true, force: true });
  const alpha = path.join(base, "alpha");
  const beta = path.join(base, "beta");
  makeRepo(alpha, "alpha", ["a.txt"]);
  makeRepo(beta, "beta", ["a.txt", "b1.txt"]);
  const workspaceFile = path.join(base, "multi.code-workspace");
  fs.writeFileSync(
    workspaceFile,
    JSON.stringify({ folders: [{ path: alpha }, { path: beta }] }, null, 2),
  );
  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite-multiroot"),
    launchArgs: [workspaceFile, "--disable-workspace-trust", "--disable-extensions"],
    extensionTestsEnv: { ...cleanEnv, DONT_PROMPT_WSL_INSTALL: "1" },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
