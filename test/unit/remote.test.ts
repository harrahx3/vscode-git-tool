import { describe, expect, it } from "vitest";
import {
  apiProject,
  apiRoot,
  branchMergeRequestsUrl,
  branchUrl,
  commitUrl,
  fileUrl,
  issuesUrl,
  mergeRequestHeadRef,
  mergeRequestUrl,
  newIssueUrl,
  newMergeRequestUrl,
  parseRemoteUrl,
  remoteInfo,
  tagUrl,
  type RemoteInfo,
} from "../../src/shared/remote";

describe("remote URLs", () => {
  it("parses SSH, scp-like and HTTPS remotes", () => {
    const expected = { scheme: "https", host: "git.example.com", path: "group/sub/repo" };
    expect(parseRemoteUrl("git@git.example.com:group/sub/repo.git")).toEqual(expected);
    expect(parseRemoteUrl("ssh://git@git.example.com:2222/group/sub/repo.git")).toEqual(expected);
    expect(parseRemoteUrl("https://user:pw@git.example.com/group/sub/repo.git")).toEqual(expected);
    expect(parseRemoteUrl("https://git.example.com/group/sub/repo/")).toEqual(expected);
    expect(parseRemoteUrl("http://git.example.com/group/sub/repo")).toEqual({
      ...expected,
      scheme: "http",
    });
  });

  it("rejects local paths and hosts without a domain", () => {
    for (const url of [
      "/srv/git/repo.git",
      "../remote.git",
      "file:///srv/git/repo.git",
      "C:\\repos\\repo.git",
      "myalias:group/repo.git",
      "",
    ])
      expect(parseRemoteUrl(url), url).toBeUndefined();
  });

  it("recognises the provider, with overrides", () => {
    expect(remoteInfo("git@github.com:o/r.git")?.provider).toBe("github");
    expect(remoteInfo("https://bitbucket.org/o/r.git")?.provider).toBe("bitbucket");
    expect(remoteInfo("git@git.example.com:g/r.git")?.provider).toBe("gitlab");
    expect(
      remoteInfo("git@git.example.com:g/r.git", { "GIT.example.com": "github" })?.provider,
    ).toBe("github");
    expect(remoteInfo("git@git.example.com:g/r.git")?.web).toBe("https://git.example.com/g/r");
  });
});

const gitlab = remoteInfo("git@git.example.com:group/sub/repo.git")!;
const github = remoteInfo("git@github.com:owner/repo.git")!;
const bitbucket = remoteInfo("git@bitbucket.org:team/repo.git")!;
const each = (fn: (r: RemoteInfo) => string) => [gitlab, github, bitbucket].map(fn);

describe("web links", () => {
  it("branches, tags and commits", () => {
    expect(each((r) => branchUrl(r, "feature/a b"))).toEqual([
      "https://git.example.com/group/sub/repo/-/tree/feature/a%20b",
      "https://github.com/owner/repo/tree/feature/a%20b",
      "https://bitbucket.org/team/repo/branch/feature/a%20b",
    ]);
    expect(each((r) => tagUrl(r, "v1.0"))).toEqual([
      "https://git.example.com/group/sub/repo/-/tags/v1.0",
      "https://github.com/owner/repo/releases/tag/v1.0",
      "https://bitbucket.org/team/repo/src/v1.0",
    ]);
    expect(each((r) => commitUrl(r, "abc123"))).toEqual([
      "https://git.example.com/group/sub/repo/-/commit/abc123",
      "https://github.com/owner/repo/commit/abc123",
      "https://bitbucket.org/team/repo/commits/abc123",
    ]);
  });

  it("files with a line or a range", () => {
    expect(each((r) => fileUrl(r, "main", "src/a.ts", [3, 7]))).toEqual([
      "https://git.example.com/group/sub/repo/-/blob/main/src/a.ts#L3-7",
      "https://github.com/owner/repo/blob/main/src/a.ts#L3-L7",
      "https://bitbucket.org/team/repo/src/main/src/a.ts#lines-3:7",
    ]);
    expect(fileUrl(gitlab, "abc", "a.ts", [5, 5])).toBe(
      "https://git.example.com/group/sub/repo/-/blob/abc/a.ts#L5",
    );
    expect(fileUrl(github, "abc", "a #1.ts")).toBe(
      "https://github.com/owner/repo/blob/abc/a%20%231.ts",
    );
  });

  it("merge requests", () => {
    expect(each((r) => mergeRequestUrl(r, 12))).toEqual([
      "https://git.example.com/group/sub/repo/-/merge_requests/12",
      "https://github.com/owner/repo/pull/12",
      "https://bitbucket.org/team/repo/pull-requests/12",
    ]);
    expect(each((r) => newMergeRequestUrl(r, "feat/x"))).toEqual([
      "https://git.example.com/group/sub/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feat%2Fx",
      "https://github.com/owner/repo/compare/feat/x?expand=1",
      "https://bitbucket.org/team/repo/pull-requests/new?source=feat%2Fx",
    ]);
    expect(newMergeRequestUrl(github, "x", "dev")).toBe(
      "https://github.com/owner/repo/compare/dev...x?expand=1",
    );
    expect(branchMergeRequestsUrl(gitlab, "feat/x")).toBe(
      "https://git.example.com/group/sub/repo/-/merge_requests?state=opened&source_branch=feat%2Fx",
    );
    expect(mergeRequestHeadRef("gitlab", 4)).toBe("refs/merge-requests/4/head");
    expect(mergeRequestHeadRef("github", 4)).toBe("refs/pull/4/head");
  });

  it("issues", () => {
    expect(each((r) => issuesUrl(r))).toEqual([
      "https://git.example.com/group/sub/repo/-/issues",
      "https://github.com/owner/repo/issues",
      "https://bitbucket.org/team/repo/issues",
    ]);
    expect(each((r) => newIssueUrl(r))).toEqual([
      "https://git.example.com/group/sub/repo/-/issues/new",
      "https://github.com/owner/repo/issues/new",
      "https://bitbucket.org/team/repo/issues/new",
    ]);
  });

  it("API roots and project paths", () => {
    expect(apiRoot(gitlab)).toBe("https://git.example.com/api/v4/");
    expect(apiRoot(github)).toBe("https://api.github.com/");
    expect(apiRoot(bitbucket)).toBeUndefined();
    expect(apiProject(gitlab)).toBe("projects/group%2Fsub%2Frepo");
    expect(apiProject(github)).toBe("repos/owner/repo");
  });
});
