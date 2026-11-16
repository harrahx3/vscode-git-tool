// VS Code's clipboard and external opener, through a named import of the API's environment
// namespace.
import { Uri, env as editorEnvironment } from "vscode";

export function copyText(text: string): Thenable<void> {
  return editorEnvironment.clipboard.writeText(text);
}

/** Opens a web page in the default browser. */
export function openExternal(url: string): Thenable<boolean> {
  return editorEnvironment.openExternal(Uri.parse(url));
}
