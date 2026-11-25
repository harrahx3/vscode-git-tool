// Reading what git hooks print: the pre-commit framework's result table, linter findings (ruff,
// flake8, mypy, eslint… as `file:line:col: message`) and plain hook scripts such as the KNIME
// repositories' checks. No VS Code dependency (unit-tested).

export interface HookResult {
  name: string;
  status: "Passed" | "Failed" | "Skipped";
  /** The hook rewrote files (formatters, `ruff --fix`): committing again picks the fixes up. */
  modifiedFiles: boolean;
  /** What the hook printed below its result line. */
  output: string;
}

export interface Finding {
  /** As printed, relative to the repository or absolute. */
  file: string;
  line: number;
  column?: number;
  code?: string;
  message: string;
  severity: "error" | "warning";
}

/** The hook git runs before a command, if any. */
export function hookOf(args: string[]): string | undefined {
  const cmd = args.find((a) => !a.startsWith("-") && !a.includes("="));
  if (cmd === "commit") return "pre-commit";
  if (cmd === "push") return "pre-push";
  if (cmd === "merge" || cmd === "pull") return "pre-merge-commit";
  if (cmd === "rebase") return "pre-rebase";
  return undefined;
}

/**
 * A hook that wants a yes/no answer but has no terminal to ask on (git runs it without one here)
 * prints its warnings, then a line `GIT_HOOK_CONFIRM: <question>`, and exits non-zero. Once the
 * user agrees, the command runs again with `GIT_HOOK_CONFIRMED=1` in its environment, and the
 * hook lets it through.
 */
export const CONFIRM_MARKER = "GIT_HOOK_CONFIRM:";
export const CONFIRMED_ENV = "GIT_HOOK_CONFIRMED";

export interface HookConfirmation {
  question: string;
  /** What the hook printed before its question: the warnings to read before answering. */
  details: string;
}

// Lines git adds around a refused push; not the hook's words.
const GIT_PUSH_LINE = /^(?:To \S|error: failed to push some refs|hint: )/;

/** The confirmation a hook asks for in `text` (its output), if any. */
export function hookConfirmation(text: string): HookConfirmation | undefined {
  const lines = stripAnsi(text).split("\n");
  const i = lines.findIndex((l) => l.trimStart().startsWith(CONFIRM_MARKER));
  if (i < 0) return undefined;
  const question = lines[i].trimStart().slice(CONFIRM_MARKER.length).trim();
  const details = lines
    .slice(0, i)
    .filter((l) => !GIT_PUSH_LINE.test(l))
    .join("\n")
    .replace(/^\s*\n/, "")
    .trimEnd();
  return { question: question || "Continue anyway?", details };
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r\n?/g, "\n");
}

const RESULT_LINE = /^(.+?)\.{3,}(?:\([^)]*\))?(Passed|Failed|Skipped)$/;

/** Result lines of the pre-commit framework (`ruff....Failed`), with each hook's output. */
export function parsePreCommit(text: string): HookResult[] {
  const results: HookResult[] = [];
  for (const line of stripAnsi(text).split("\n")) {
    const m = RESULT_LINE.exec(line.trimEnd());
    if (m) {
      results.push({
        name: m[1].trim(),
        status: m[2] as HookResult["status"],
        modifiedFiles: false,
        output: "",
      });
      continue;
    }
    const last = results.at(-1);
    if (!last) continue;
    if (/^- files were modified by this hook/.test(line)) {
      last.modifiedFiles = true;
      continue;
    }
    if (/^- (?:hook id|exit code|duration):/.test(line)) continue;
    last.output += `${line}\n`;
  }
  for (const r of results) r.output = r.output.trim();
  return results;
}

const SEVERITY_WARNING = /\bwarning\b|^W\d|^C\d|^N\d|^D\d/i;

/** `file:line[:col]: message` locations, and ruff's `CODE message` + `--> file:line:col`. */
export function parseFindings(text: string): Finding[] {
  const lines = stripAnsi(text).split("\n");
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const add = (f: Finding) => {
    const key = `${f.file}:${f.line}:${f.column ?? 0}:${f.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(f);
    }
  };
  lines.forEach((line, i) => {
    // ruff ≥ 0.9 "full" format: "F401 [*] `os` imported but unused" then " --> a.py:1:8".
    const arrow = /^\s*-->\s*(.+?):(\d+):(\d+)\s*$/.exec(line);
    if (arrow) {
      const header = lines
        .slice(Math.max(0, i - 2), i)
        .reverse()
        .find((l) => /^[A-Z]+\d+\b|^(?:error|warning)\b/.test(l.trim()));
      const h = header ? /^([A-Z]+\d+)?\s*(?:\[\*\]\s*)?(.*)$/.exec(header.trim()) : null;
      add({
        file: arrow[1].trim(),
        line: Number(arrow[2]),
        column: Number(arrow[3]),
        code: h?.[1],
        message: h?.[2] || "Problem reported by the hook",
        severity: h?.[1] && SEVERITY_WARNING.test(h[1]) ? "warning" : "error",
      });
      return;
    }
    // Concise: "src/a.py:3:1: F401 [*] `os` imported but unused", mypy "a.py:3: error: …".
    const m = /^([^\s:][^:\n]*?\.[\w]+):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line.trim());
    if (!m || /^https?$/.test(m[1])) return;
    const rest = m[4].replace(/^\[\*\]\s*/, "");
    const code = /^([A-Z]+\d+)\b\s*(?:\[\*\]\s*)?/.exec(rest);
    const message = code ? rest.slice(code[0].length) : rest.replace(/^(?:error|note):\s*/, "");
    add({
      file: m[1],
      line: Number(m[2]),
      column: m[3] ? Number(m[3]) : undefined,
      code: code?.[1],
      message: message.trim(),
      severity: SEVERITY_WARNING.test(code?.[1] ?? rest) ? "warning" : "error",
    });
  });
  return findings;
}

/** A one-line summary of what hooks printed on success, for the status bar. */
export function hookSummary(text: string): string | undefined {
  const results = parsePreCommit(text);
  if (results.length) {
    const count = (s: HookResult["status"]) => results.filter((r) => r.status === s).length;
    const parts = [`${count("Passed")} passed`];
    if (count("Skipped")) parts.push(`${count("Skipped")} skipped`);
    return `pre-commit: ${parts.join(", ")}`;
  }
  const first = stripAnsi(text)
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  return first ? first.slice(0, 160) : undefined;
}

export interface ReportInput {
  /** "Commit", "Push"… */
  title: string;
  hook: string;
  command: string;
  output: string;
  /** Turns a finding's file into a link target (file URI with a #L line fragment). */
  link: (f: Finding) => string | undefined;
  when: string;
}

const fence = (text: string) => {
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  return `${ticks}text\n${text}\n${ticks}`;
};
const ICON: Record<HookResult["status"], string> = { Passed: "✅", Failed: "❌", Skipped: "⏭️" };

/** The Markdown report shown when a hook stops a commit or a push. */
export function hookReport(r: ReportInput): string {
  const output = stripAnsi(r.output).trim();
  const results = parsePreCommit(output);
  const findings = parseFindings(output);
  const out: string[] = [
    `# ${r.title} blocked by the ${r.hook} hook`,
    "",
    `\`git ${r.command}\` · ${r.when}`,
    "",
  ];
  if (results.length) {
    out.push("## Hooks", "", "| Hook | Result |", "| --- | --- |");
    for (const h of results)
      out.push(
        `| ${h.name.replace(/\|/g, "\\|")} | ${ICON[h.status]} ${h.status}${h.modifiedFiles ? " — files fixed, commit again to include the fixes" : ""} |`,
      );
    out.push("");
  }
  if (findings.length) {
    out.push(`## Problems (${findings.length})`, "");
    for (const f of findings.slice(0, 200)) {
      const where = `${f.file}:${f.line}${f.column ? `:${f.column}` : ""}`;
      const target = r.link(f);
      const loc = target ? `[${where}](${target})` : `\`${where}\``;
      out.push(
        `- ${f.severity === "warning" ? "⚠️" : "❌"} ${loc} ${f.code ? `**${f.code}** ` : ""}${f.message}`,
      );
    }
    out.push("", "They are also listed in the Problems panel.", "");
  }
  const failed = results.filter((h) => h.status === "Failed");
  if (failed.length)
    for (const h of failed)
      out.push(`## Output of ${h.name}`, "", fence(h.output || "(no output)"), "");
  else out.push("## Output", "", fence(output || "(no output)"), "");
  out.push(
    "---",
    "",
    `Fix the problems and ${r.title.toLowerCase()} again. Skipping the hooks (\`--no-verify\`) is possible from the notification, but the checks exist for a reason.`,
  );
  return out.join("\n");
}
