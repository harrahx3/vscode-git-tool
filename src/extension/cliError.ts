// Why a `glab` / `gh` call failed: no vscode import, so the logic stays unit-testable.

/** The error `execFile` passes to its callback: a string errno when the process could not be started, a number when it exited non-zero. */
export interface CliError {
  code?: string | number;
  stderr?: string;
  message?: string;
}

/**
 * True when the CLI is not usable without the user's help: it could not be started (not
 * installed), or it ran but is not logged in to the host.
 *
 * Any string errno counts as "could not be started", not only ENOENT: Node's execvp keeps a
 * permission error from an unreadable PATH entry (typically a Windows folder on the WSL PATH)
 * over "not found", so a missing `gh` is reported as `spawn gh EACCES`.
 */
export function needsCredentials(err: CliError): boolean {
  if (typeof err.code === "string") return true;
  return /auth|login|token|401|403/i.test(err.stderr ?? "");
}
