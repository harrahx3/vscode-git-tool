// Shows why a hook stopped a commit or a push: a Markdown report beside the editor (hook results,
// linter findings linked to their lines, full output), the findings in the Problems panel, and a
// notification to commit again, open the report or skip the hooks.
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { hookReport, parseFindings, parsePreCommit, type Finding } from "./hooks";
import { getHost } from "./output";
import type { Git } from "./runner";

let diagnostics: vscode.DiagnosticCollection | undefined;

function collection(): vscode.DiagnosticCollection {
  diagnostics ??= vscode.languages.createDiagnosticCollection("Git hooks");
  return diagnostics;
}

/** Clears the hook findings from the Problems panel (after a successful commit or push). */
export function clearHookProblems(): void {
  diagnostics?.clear();
}

/** Whether the repository has this hook installed (core.hooksPath included). */
export async function hookExists(git: Git, hook: string): Promise<boolean> {
  try {
    const rel = (await git.run(["rev-parse", "--git-path", `hooks/${hook}`])).trim();
    fs.accessSync(path.resolve(git.root, rel), fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function fileOf(root: string, f: Finding): string | undefined {
  const abs = path.isAbsolute(f.file) ? f.file : path.join(root, f.file);
  return fs.existsSync(abs) ? abs : undefined;
}

function publish(root: string, findings: Finding[]): number {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const f of findings) {
    const abs = fileOf(root, f);
    if (!abs) continue;
    const pos = new vscode.Position(Math.max(0, f.line - 1), Math.max(0, (f.column ?? 1) - 1));
    const d = new vscode.Diagnostic(
      new vscode.Range(pos, pos.translate(0, 1)),
      f.message,
      f.severity === "warning"
        ? vscode.DiagnosticSeverity.Warning
        : vscode.DiagnosticSeverity.Error,
    );
    d.source = "git hook";
    if (f.code) d.code = f.code;
    byFile.set(abs, [...(byFile.get(abs) ?? []), d]);
  }
  const c = collection();
  c.clear();
  for (const [file, list] of byFile) c.set(vscode.Uri.file(file), list);
  return [...byFile.values()].reduce((n, l) => n + l.length, 0);
}

async function openReport(markdown: string): Promise<void> {
  const dir = getHost().reportDir;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const file = vscode.Uri.file(path.join(dir, "hook-report.md"));
  fs.writeFileSync(file.fsPath, markdown, "utf8");
  await vscode.commands.executeCommand("markdown.showPreviewToSide", file);
}

/**
 * Reports a hook failure. `again` re-runs the operation, `skipHooks` runs it with --no-verify
 * (after a confirmation).
 */
export async function showHookFailure(
  title: string,
  git: Git,
  hook: string,
  args: string[],
  output: string,
  again: () => Promise<unknown>,
  skipHooks: (() => Promise<unknown>) | undefined,
): Promise<void> {
  const results = parsePreCommit(output);
  const findings = parseFindings(output);
  const problems = publish(git.root, findings);
  const report = hookReport({
    title,
    hook,
    command: args.join(" "),
    output,
    when: new Date().toLocaleString(),
    link: (f) => {
      const abs = fileOf(git.root, f);
      return abs && `${vscode.Uri.file(abs).toString()}#L${f.line}`;
    },
  });
  await openReport(report);
  const failed = results.filter((r) => r.status === "Failed");
  const fixed = failed.some((r) => r.modifiedFiles);
  const what = failed.length
    ? `${failed.map((r) => r.name).join(", ")} failed`
    : (output.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 120);
  const extra = [
    problems ? `${problems} problem${problems === 1 ? "" : "s"} in the Problems panel` : "",
    fixed ? "files were fixed by the hook" : "",
  ]
    .filter(Boolean)
    .join(", ");
  const actions: Record<string, () => unknown> = {
    [fixed ? `${title} Again (with the fixes)` : "Retry"]: again,
    "Show Report": () => openReport(report),
  };
  if (skipHooks)
    actions["Skip Hooks…"] = async () => {
      const ok = await vscode.window.showWarningMessage(
        `${title} without running the ${hook} hook?`,
        {
          modal: true,
          detail: `git ${args[0]} --no-verify. The checks of the ${hook} hook are skipped: what they guard against may reach the repository.`,
        },
        "Skip Hooks",
      );
      if (ok) return skipHooks();
    };
  const choice = await vscode.window.showErrorMessage(
    `${title} blocked by the ${hook} hook: ${what}${extra ? ` (${extra})` : ""}.`,
    ...Object.keys(actions),
  );
  if (choice) {
    await actions[choice]();
    getHost().refresh();
  }
}
