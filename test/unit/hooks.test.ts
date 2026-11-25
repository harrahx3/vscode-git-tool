import { describe, expect, it } from "vitest";
import {
  hookConfirmation,
  hookOf,
  hookReport,
  hookSummary,
  parseFindings,
  parsePreCommit,
} from "../../src/extension/git/hooks";
import { apiNetworkTask } from "../../src/extension/git/network";
import { refNameProblem, suggestTag } from "../../src/shared/refNames";

const PRE_COMMIT = `ruff.....................................................................Failed
- hook id: ruff
- exit code: 1
- files were modified by this hook

src/app.py:3:8: F401 [*] \`os\` imported but unused
src/app.py:10:1: E501 Line too long (120 > 100)
Found 2 errors.
[*] 1 fixable with the \`--fix\` option.

ruff-format..............................................................Passed
check yaml...........................................(no files to check)Skipped
`;

describe("pre-commit framework output", () => {
  it("reads the hook results and their output", () => {
    const r = parsePreCommit(PRE_COMMIT);
    expect(r.map((x) => [x.name, x.status, x.modifiedFiles])).toEqual([
      ["ruff", "Failed", true],
      ["ruff-format", "Passed", false],
      ["check yaml", "Skipped", false],
    ]);
    expect(r[0].output).toMatch(/^src\/app.py:3:8/);
    expect(hookSummary(PRE_COMMIT)).toBe("pre-commit: 1 passed, 1 skipped");
  });

  it("finds ruff's problems, concise and full formats, and mypy's", () => {
    expect(parseFindings(PRE_COMMIT)).toEqual([
      {
        file: "src/app.py",
        line: 3,
        column: 8,
        code: "F401",
        message: "`os` imported but unused",
        severity: "error",
      },
      {
        file: "src/app.py",
        line: 10,
        column: 1,
        code: "E501",
        message: "Line too long (120 > 100)",
        severity: "error",
      },
    ]);
    const full = "F401 [*] `os` imported but unused\n --> src/a.py:1:8\n  |\n1 | import os\n";
    expect(parseFindings(full)).toMatchObject([
      { file: "src/a.py", line: 1, column: 8, code: "F401" },
    ]);
    expect(parseFindings("pkg/m.py:12: error: Incompatible types  [assignment]")).toMatchObject([
      { file: "pkg/m.py", line: 12, message: "Incompatible types  [assignment]" },
    ]);
    expect(parseFindings("error: failed to push some refs to 'https://h/r.git'")).toEqual([]);
  });

  it("builds a report with the results table, linked problems and the output", () => {
    const md = hookReport({
      title: "Commit",
      hook: "pre-commit",
      command: "commit --only -- src/app.py",
      output: PRE_COMMIT,
      when: "today",
      link: (f) => `file:///repo/${f.file}#L${f.line}`,
    });
    expect(md).toContain("# Commit blocked by the pre-commit hook");
    expect(md).toContain("| ruff | ❌ Failed — files fixed, commit again to include the fixes |");
    expect(md).toContain("[src/app.py:3:8](file:///repo/src/app.py#L3) **F401**");
    expect(md).toContain("## Output of ruff");
  });

  it("shows a plain hook script's output (the KNIME repositories' checks)", () => {
    const out =
      "ERROR: component saved as a LINKED instance of a shared component:\n  - foo (#12)\n";
    const md = hookReport({
      title: "Push",
      hook: "pre-push",
      command: "push origin refs/tags/x",
      output: out,
      when: "today",
      link: () => undefined,
    });
    expect(md).toContain("## Output\n\n```text\nERROR: component saved");
    expect(hookSummary("KNIME state OK: no linked component.\n")).toBe(
      "KNIME state OK: no linked component.",
    );
  });

  it("knows which hook a command runs", () => {
    expect(hookOf(["commit", "--file=-"])).toBe("pre-commit");
    expect(hookOf(["-c", "commit.gpgsign=false", "commit"])).toBe("pre-commit");
    expect(hookOf(["push", "origin", "main"])).toBe("pre-push");
    expect(hookOf(["switch", "main"])).toBeUndefined();
  });
});

describe("fetch and push through VS Code's Git extension", () => {
  const calls: unknown[][] = [];
  const api = {
    fetch: async (o?: unknown) => void calls.push(["fetch", o]),
    push: async (...a: unknown[]) => void calls.push(["push", ...a]),
  };
  const run = async (args: string[]) => {
    calls.length = 0;
    const task = apiNetworkTask(api, args);
    if (!task) return undefined;
    await task();
    return calls[0];
  };

  it("maps the commands this extension runs", async () => {
    expect(await run(["fetch", "--all", "--prune"])).toEqual([
      "fetch",
      { all: true, remote: undefined, prune: true },
    ]);
    expect(await run(["fetch", "--prune", "origin"])).toEqual([
      "fetch",
      { all: undefined, remote: "origin", prune: true },
    ]);
    expect(await run(["fetch", "origin", "refs/merge-requests/7/head"])).toEqual([
      "fetch",
      { remote: "origin", ref: "refs/merge-requests/7/head", prune: false },
    ]);
    expect(await run(["push", "--set-upstream", "origin", "main"])).toEqual([
      "push",
      "origin",
      "main",
      true,
      undefined,
    ]);
    expect(await run(["push", "--force-with-lease", "origin", "main:main"])).toEqual([
      "push",
      "origin",
      "main:main",
      false,
      1,
    ]);
    expect(await run(["push", "--delete", "origin", "refs/tags/v1"])).toEqual([
      "push",
      "origin",
      ":refs/tags/v1",
      false,
      undefined,
    ]);
  });

  it("leaves other shapes to plain git", async () => {
    expect(await run(["push", "origin", "--tags"])).toBeUndefined();
    expect(await run(["push"])).toBeUndefined();
    expect(await run(["fetch"])).toBeUndefined();
    expect(await run(["fetch", "--all", "origin"])).toBeUndefined();
    expect(await run(["fetch", "origin", "a", "b"])).toBeUndefined();
    expect(await run(["pull"])).toBeUndefined();
  });
});

describe("branch and tag names", () => {
  it("rejects invalid and existing names", () => {
    expect(refNameProblem("feature/x", ["main"], "branch")).toBeUndefined();
    for (const bad of ["", "a b", "a..b", "a~1", "x.lock", "-x", "a/", "a//b", "a:b", "@"])
      expect(refNameProblem(bad, [], "branch"), bad).toBeDefined();
    expect(refNameProblem("main", ["main"], "branch")).toBe("A branch named main already exists");
  });

  it("suggests the next tag from the previous ones", () => {
    const today = new Date(2026, 10, 10);
    expect(suggestTag(["PES_mobilite_261021", "v1.0.0"], today)).toBe("PES_mobilite_261110");
    expect(suggestTag(["BEBOP_20261021"], today)).toBe("BEBOP_20261110");
    expect(suggestTag(["v0.2.0", "v0.1.0"], today)).toBe("v0.2.1");
    expect(suggestTag(["1.4.9"], today)).toBe("1.4.10");
    expect(suggestTag(["release-candidate"], today)).toBe("");
    expect(suggestTag([], today)).toBe("");
  });
});

describe("a hook asking for a confirmation", () => {
  it("reads the question and the warnings before it, without git's own lines", () => {
    const text = [
      "",
      "WARNING: pushing this tag also releases the other project.",
      "  v1  ->  tag created on the other project",
      "",
      "GIT_HOOK_CONFIRM: Push anyway?",
      "No terminal to answer on: confirm in your Git client, or push from a terminal.",
      "error: failed to push some refs to '/tmp/remote'",
    ].join("\n");
    expect(hookConfirmation(text)).toEqual({
      question: "Push anyway?",
      details:
        "WARNING: pushing this tag also releases the other project.\n  v1  ->  tag created on the other project",
    });
  });

  it("gives a default question, and nothing without the marker", () => {
    expect(hookConfirmation("GIT_HOOK_CONFIRM:")?.question).toBe("Continue anyway?");
    expect(hookConfirmation("error: failed to push some refs to 'x'")).toBeUndefined();
  });
});
