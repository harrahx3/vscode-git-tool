// Builds a fixture repository, downloads VS Code (cached in .vscode-test/) and runs the
// integration suite. Needs a display (WSLg on Windows, or xvfb-run on a headless Linux).
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

/**
 * Variables that make a nested VS Code misbehave when the tests are started from a VS Code
 * terminal: ELECTRON_RUN_AS_NODE turns it into plain Node, VSCODE_* route the CLI to the
 * running (remote) instance instead of the downloaded one.
 */
function inheritedVsCodeVariables(): string[] {
  return Object.keys(process.env).filter(
    (k) => k === "ELECTRON_RUN_AS_NODE" || k.startsWith("VSCODE_"),
  );
}

function makeFixtureRepo(dir: string): void {
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
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo\nthree\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first commit");
  git("switch", "-q", "-c", "feature");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo (feature)\nthree\n");
  git("commit", "-q", "-am", "feature change");
  git("switch", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "Merge feature", "feature");
  fs.writeFileSync(path.join(dir, "a.txt"), "one\ntwo (feature)\nthree\nfour\n");
}

async function main(): Promise<void> {
  const cleanEnv: Record<string, undefined> = {};
  for (const key of inheritedVsCodeVariables()) cleanEnv[key] = undefined;
  const root = path.resolve(__dirname, "../../..");
  const repo = path.join(root, "out", "fixtures", "repo");
  makeFixtureRepo(repo);
  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(__dirname, "suite"),
    launchArgs: [repo, "--disable-workspace-trust", "--disable-extensions"],
    extensionTestsEnv: cleanEnv,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
