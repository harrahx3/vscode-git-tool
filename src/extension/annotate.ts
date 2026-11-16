// Annotate (git blame) in the editor gutter: date and author per block of lines, shaded by age,
// with a hover giving the commit and a link to it in the Log.
import * as vscode from "vscode";
import type { BlameLine } from "../shared/types";
import { blame } from "./git/queries";
import type { Repos } from "./git/repos";

const CONTEXT_KEY = "gitTool.annotated";
const WIDTH_CH = 24;

/** Pads with non-breaking spaces (decoration text collapses ordinary ones). */
function pad(text: string, width: number): string {
  const cut = text.length > width ? text.slice(0, width - 1) + "…" : text;
  return cut + " ".repeat(Math.max(0, width - cut.length));
}

function formatDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Shading: the newest commit of the file is strongest, the oldest almost transparent. */
function ageAlpha(time: number, oldest: number, newest: number): number {
  if (newest <= oldest) return 0.25;
  return 0.05 + 0.3 * ((time - oldest) / (newest - oldest));
}

export class Annotations implements vscode.Disposable {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    before: { margin: "0 1.2em 0 0" },
  });
  /** Annotated documents (URI strings). */
  private readonly active = new Set<string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly repos: Repos) {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.renderVisible()),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidSaveTextDocument((d) => this.schedule(d)),
      vscode.workspace.onDidCloseTextDocument((d) => this.active.delete(d.uri.toString())),
    );
  }

  isActive(editor: vscode.TextEditor | undefined): boolean {
    return !!editor && this.active.has(editor.document.uri.toString());
  }

  async toggle(editor = vscode.window.activeTextEditor): Promise<void> {
    if (!editor) return;
    const key = editor.document.uri.toString();
    if (this.active.has(key)) {
      this.active.delete(key);
      for (const e of this.editorsOf(editor.document)) e.setDecorations(this.decoration, []);
    } else {
      this.active.add(key);
      await this.render(editor.document);
    }
    this.updateContext();
  }

  private updateContext(): void {
    void vscode.commands.executeCommand(
      "setContext",
      CONTEXT_KEY,
      this.isActive(vscode.window.activeTextEditor),
    );
  }

  private editorsOf(doc: vscode.TextDocument): vscode.TextEditor[] {
    return vscode.window.visibleTextEditors.filter((e) => e.document === doc);
  }

  private renderVisible(): void {
    const seen = new Set<vscode.TextDocument>();
    for (const e of vscode.window.visibleTextEditors) {
      if (this.active.has(e.document.uri.toString()) && !seen.has(e.document)) {
        seen.add(e.document);
        void this.render(e.document);
      }
    }
  }

  private schedule(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    if (!this.active.has(key)) return;
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => void this.render(doc), 400),
    );
  }

  private async render(doc: vscode.TextDocument): Promise<void> {
    const target = this.repos.forFile(doc.uri);
    if (!target) {
      this.active.delete(doc.uri.toString());
      return;
    }
    let lines: BlameLine[];
    try {
      lines = await blame(target.git, target.rel, doc.isDirty ? doc.getText() : undefined);
    } catch (e) {
      this.active.delete(doc.uri.toString());
      this.updateContext();
      const message = e instanceof Error ? e.message : String(e);
      void vscode.window.showWarningMessage(`Cannot annotate: ${message}`);
      return;
    }
    if (!this.active.has(doc.uri.toString())) return;
    const options = this.decorations(lines, doc.lineCount);
    for (const e of this.editorsOf(doc)) e.setDecorations(this.decoration, options);
  }

  decorations(lines: BlameLine[], lineCount: number): vscode.DecorationOptions[] {
    const committed = lines.filter((l) => !l.uncommitted).map((l) => l.authorTime);
    const oldest = committed.length ? Math.min(...committed) : 0;
    const newest = committed.length ? Math.max(...committed) : 0;
    const hovers = new Map<string, vscode.MarkdownString>();
    const result: vscode.DecorationOptions[] = [];
    for (let i = 0; i < Math.min(lines.length, lineCount); i++) {
      const line = lines[i];
      const firstOfBlock = i === 0 || lines[i - 1].hash !== line.hash;
      const label = line.uncommitted
        ? "Not committed yet"
        : `${formatDate(line.authorTime)} ${line.author}`;
      const alpha = line.uncommitted ? 0 : ageAlpha(line.authorTime, oldest, newest);
      let hover = hovers.get(line.hash);
      if (!hover && !line.uncommitted) {
        hover = new vscode.MarkdownString(undefined, true);
        hover.isTrusted = { enabledCommands: ["gitTool.showCommitInLog"] };
        const args = encodeURIComponent(JSON.stringify([line.hash]));
        hover.appendMarkdown(
          `$(git-commit) **${line.hash.slice(0, 8)}** · ${escapeMarkdown(line.author)} · ${new Date(
            line.authorTime * 1000,
          ).toLocaleString()}\n\n${escapeMarkdown(line.summary)}\n\n` +
            `[Show in Git Log](command:gitTool.showCommitInLog?${args})`,
        );
        hovers.set(line.hash, hover);
      }
      result.push({
        range: new vscode.Range(i, 0, i, 0),
        hoverMessage: hover,
        renderOptions: {
          before: {
            contentText: pad(firstOfBlock ? label : "", WIDTH_CH),
            color: new vscode.ThemeColor(
              line.uncommitted ? "editorLineNumber.foreground" : "editorCodeLens.foreground",
            ),
            backgroundColor: `rgba(80, 140, 220, ${alpha.toFixed(3)})`,
            fontStyle: "normal",
            fontWeight: "normal",
          },
        },
      });
    }
    return result;
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
    this.decoration.dispose();
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");
}
