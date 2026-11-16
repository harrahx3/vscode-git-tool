// The dialogs of the recovery actions.
import * as vscode from "vscode";
import { getHost } from "./output";

export type Task = () => Promise<unknown>;
export type Actions = Record<string, () => unknown>;

/** Shows a message; runs the chosen action, then refreshes the views. */
export async function ask(
  level: "error" | "warning" | "info",
  message: string,
  actions: Actions,
  modal?: { detail: string },
): Promise<unknown> {
  const show =
    level === "error"
      ? vscode.window.showErrorMessage
      : level === "warning"
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;
  const choice = await show(
    message,
    modal ? { modal: true, detail: modal.detail } : {},
    ...Object.keys(actions),
  );
  if (!choice) return undefined;
  const result = await actions[choice]();
  getHost().refresh();
  return result;
}
