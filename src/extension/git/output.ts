// The "Git Tool" output channel, and how recovery actions reach the views.
import * as vscode from "vscode";
import type { Git } from "./runner";

let output: vscode.OutputChannel | undefined;

export function outputChannel(): vscode.OutputChannel {
  output ??= vscode.window.createOutputChannel("Git Tool");
  return output;
}

export interface Host {
  /** Refreshes the views after a recovery action (they also follow the repository). */
  refresh(): void;
  /** Git of the current repository, for errors that do not carry one. */
  currentGit(): Git | undefined;
  /** Folder for the hook report (the extension's storage). */
  reportDir?: string;
}

let host: Host = { refresh: () => undefined, currentGit: () => undefined };

export function setHost(h: Host): void {
  host = h;
}

export function getHost(): Host {
  return host;
}
