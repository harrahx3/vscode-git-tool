import { describe, expect, it } from "vitest";
import { fromGitHub, fromGitLab, statusText } from "../../src/shared/mergeRequests";

// Trimmed from real API answers.
const gitlabMr = {
  iid: 100,
  title: "Serve tiles from a Lambda",
  web_url: "https://git.example.com/g/r/-/merge_requests/100",
  source_branch: "refactor/tiles",
  target_branch: "development",
  author: { username: "alice", name: "Alice A" },
  assignees: [{ username: "bob" }],
  reviewers: [],
  draft: false,
  has_conflicts: true,
  detailed_merge_status: "ci_still_running",
  labels: ["backend"],
  user_notes_count: 3,
  created_at: "2026-11-09T16:36:12.375+01:00",
  updated_at: "2026-11-09T16:36:13.811+01:00",
  description: "Body",
  sha: "8a45f5ec",
  source_project_id: 735,
  target_project_id: 735,
};

const githubPr = {
  number: 7,
  title: "Fix it",
  html_url: "https://github.com/o/r/pull/7",
  user: { login: "carol" },
  assignees: [],
  requested_reviewers: [{ login: "bob" }],
  draft: true,
  labels: [{ name: "bug" }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  body: null,
  head: { ref: "fix", sha: "abc", repo: { full_name: "carol/r" } },
  base: { ref: "main", repo: { full_name: "o/r" } },
};

describe("merge request normalization", () => {
  it("reads a GitLab merge request", () => {
    expect(fromGitLab(gitlabMr)).toMatchObject({
      id: 100,
      source: "refactor/tiles",
      target: "development",
      author: "alice",
      authorName: "Alice A",
      assignees: ["bob"],
      conflicts: true,
      labels: ["backend"],
      comments: 3,
      headSha: "8a45f5ec",
      fork: false,
    });
  });

  it("reads a GitHub pull request from a fork", () => {
    expect(fromGitHub(githubPr)).toMatchObject({
      id: 7,
      url: "https://github.com/o/r/pull/7",
      source: "fix",
      target: "main",
      author: "carol",
      reviewers: ["bob"],
      draft: true,
      labels: ["bug"],
      description: "",
      headSha: "abc",
      fork: true,
    });
  });

  it("describes the status", () => {
    expect(statusText(fromGitLab(gitlabMr))).toBe("conflicts, pipeline running");
    expect(statusText(fromGitHub(githubPr))).toBe("draft");
  });
});
