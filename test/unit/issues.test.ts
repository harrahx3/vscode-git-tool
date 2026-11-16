import { describe, expect, it } from "vitest";
import {
  isGitHubPullRequest,
  issueBranchName,
  issueFromGitHub,
  issueFromGitLab,
} from "../../src/shared/issues";

// Trimmed from real API answers.
const gitlabIssue = {
  iid: 42,
  title: "Tiles are blank after zoom",
  web_url: "https://git.example.com/g/r/-/issues/42",
  author: { username: "alice", name: "Alice A" },
  assignees: [{ username: "bob" }],
  labels: ["bug", "frontend"],
  milestone: { title: "v1.2" },
  user_notes_count: 4,
  confidential: true,
  created_at: "2026-11-09T16:36:12.375+01:00",
  updated_at: "2026-11-10T09:00:00.000+01:00",
  due_date: "2026-11-30",
  description: "Steps to reproduce",
};

const githubIssue = {
  number: 9,
  title: "Crash on start",
  html_url: "https://github.com/o/r/issues/9",
  user: { login: "carol" },
  assignees: [{ login: "me" }],
  labels: [{ name: "bug" }],
  milestone: null,
  comments: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  body: null,
};

describe("issue normalization", () => {
  it("reads a GitLab issue", () => {
    expect(issueFromGitLab(gitlabIssue)).toEqual({
      id: 42,
      title: "Tiles are blank after zoom",
      url: "https://git.example.com/g/r/-/issues/42",
      author: "alice",
      authorName: "Alice A",
      assignees: ["bob"],
      labels: ["bug", "frontend"],
      milestone: "v1.2",
      comments: 4,
      confidential: true,
      createdAt: "2026-11-09T16:36:12.375+01:00",
      updatedAt: "2026-11-10T09:00:00.000+01:00",
      dueDate: "2026-11-30",
      description: "Steps to reproduce",
    });
  });

  it("reads a GitHub issue and recognises pull requests in the list", () => {
    expect(issueFromGitHub(githubIssue)).toMatchObject({
      id: 9,
      url: "https://github.com/o/r/issues/9",
      author: "carol",
      assignees: ["me"],
      labels: ["bug"],
      milestone: undefined,
      comments: 2,
      confidential: false,
      description: "",
    });
    expect(isGitHubPullRequest(githubIssue)).toBe(false);
    expect(isGitHubPullRequest({ ...githubIssue, pull_request: { url: "x" } })).toBe(true);
  });
});

describe("issue branch name", () => {
  it("is the number and the title in kebab case", () => {
    expect(issueBranchName({ id: 12, title: "Fix the Login page!" })).toBe("12-fix-the-login-page");
    expect(issueBranchName({ id: 3, title: "Équipe: données « météo »" })).toBe(
      "3-equipe-donnees-meteo",
    );
    expect(issueBranchName({ id: 5, title: "???" })).toBe("5");
  });

  it("cuts a long title at a word boundary", () => {
    const name = issueBranchName({ id: 7, title: "word ".repeat(30) }, 20);
    expect(name).toBe("7-word-word-word-word");
  });
});
