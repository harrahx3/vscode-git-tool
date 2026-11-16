import { describe, expect, it } from "vitest";
import { needsCredentials } from "../../src/extension/cliError";

describe("needsCredentials", () => {
  it("treats a CLI that could not be started as not installed", () => {
    // ENOENT: not on PATH. EACCES: Node's execvp keeps a permission error from an unreadable
    // PATH entry (a Windows folder on the WSL PATH) over "not found", so `gh` missing shows as
    // `spawn gh EACCES`.
    expect(needsCredentials({ code: "ENOENT" })).toBe(true);
    expect(needsCredentials({ code: "EACCES", message: "spawn gh EACCES" })).toBe(true);
  });

  it("treats a CLI that is installed but not logged in as needing credentials", () => {
    expect(
      needsCredentials({
        code: 4,
        stderr: "gh: To get started with GitHub CLI, please run: gh auth login",
      }),
    ).toBe(true);
    expect(needsCredentials({ code: 1, stderr: "HTTP 401: Bad credentials" })).toBe(true);
  });

  it("passes other failures through", () => {
    expect(needsCredentials({ code: 1, stderr: "HTTP 500: Internal Server Error" })).toBe(false);
    expect(needsCredentials({ code: 1, stderr: "" })).toBe(false);
  });
});
