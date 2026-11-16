// Read-only documents for a file at a revision (`git-tool:` URIs) and diff helpers.
import * as path from "path";
import * as vscode from "vscode";
import { showFile } from "./git/queries";
import type { Repos } from "./git/repos";

export const SCHEME = "git-tool";

interface RevisionQuery {
  root: string;
  /** Revision; empty = an empty document (file absent on that side). */
  ref: string;
  path: string;
}

/** URI of `relPath` at `ref`. The URI path is the real file path so editors pick the language. */
export function revisionUri(root: string, ref: string, relPath: string): vscode.Uri {
  const query: RevisionQuery = { root, ref, path: relPath };
  return vscode.Uri.from({
    scheme: SCHEME,
    path: vscode.Uri.file(path.join(root, relPath)).path,
    query: JSON.stringify(query),
  });
}

export class RevisionProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly repos: Repos) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const q = JSON.parse(uri.query) as RevisionQuery;
    if (!q.ref) return "";
    return showFile(this.repos.git(q.root), q.ref, q.path);
  }
}

export const shortHash = (hash: string): string => hash.slice(0, 8);

/** Diff of a file changed by a commit, against the commit's first parent. */
export async function openCommitDiff(
  root: string,
  hash: string,
  parent: string | undefined,
  relPath: string,
  oldPath?: string,
): Promise<void> {
  const left = revisionUri(root, parent ?? "", oldPath ?? relPath);
  const right = revisionUri(root, hash, relPath);
  const before = parent ? shortHash(parent) : "empty";
  const title = `${path.basename(relPath)} (${before} ↔ ${shortHash(hash)})`;
  await vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true });
}

/** Diff of the working-tree file against HEAD (an added/untracked file against empty). */
export async function openWorkingDiff(
  root: string,
  relPath: string,
  oldPath: string | undefined,
  existsInHead: boolean,
  deleted = false,
): Promise<void> {
  const file = deleted ? revisionUri(root, "", relPath) : vscode.Uri.file(path.join(root, relPath));
  const left = revisionUri(root, existsInHead ? "HEAD" : "", oldPath ?? relPath);
  const title = `${path.basename(relPath)} (HEAD ↔ working tree)`;
  await vscode.commands.executeCommand("vscode.diff", left, file, title, { preview: true });
}
