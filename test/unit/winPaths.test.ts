import { describe, expect, it } from "vitest";
import { gitPathToLocal } from "../../src/shared/winPaths";

describe("gitPathToLocal", () => {
  it("maps a Windows drive path to its WSL mount on Linux", () => {
    expect(gitPathToLocal("C:/Users/me/repo", "linux")).toBe("/mnt/c/Users/me/repo");
    expect(gitPathToLocal("D:\\data\\repo", "linux")).toBe("/mnt/d/data/repo");
  });
  it("leaves other paths and other platforms alone", () => {
    expect(gitPathToLocal("/home/me/repo", "linux")).toBe("/home/me/repo");
    expect(gitPathToLocal("C:/Users/me/repo", "win32")).toBe("C:/Users/me/repo");
  });
});
