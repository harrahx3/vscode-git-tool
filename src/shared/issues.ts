// Issues of GitLab and GitHub in one shape, and the name of a branch for an issue. Pure
// functions, no VS Code dependency (unit-tested).

export interface Issue {
  /** GitLab `iid`, GitHub `number`. */
  id: number;
  title: string;
  url: string;
  /** Username / login of the author. */
  author: string;
  authorName: string;
  assignees: string[];
  labels: string[];
  milestone?: string;
  comments?: number;
  /** GitLab only. */
  confidential: boolean;
  createdAt: string;
  updatedAt: string;
  /** Due date, `YYYY-MM-DD` (GitLab only). */
  dueDate?: string;
  description: string;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

/** A GitLab issue (REST API v4, `GET /projects/:id/issues`). */
export function issueFromGitLab(j: Json): Issue {
  const user = (u: unknown) => str(obj(u).username);
  return {
    id: Number(j.iid),
    title: str(j.title),
    url: str(j.web_url),
    author: user(j.author),
    authorName: str(obj(j.author).name) || user(j.author),
    assignees: arr(j.assignees).map(user),
    labels: arr(j.labels).map((l) => (typeof l === "string" ? l : str(obj(l).name))),
    milestone: str(obj(j.milestone).title) || undefined,
    comments: typeof j.user_notes_count === "number" ? j.user_notes_count : undefined,
    confidential: j.confidential === true,
    createdAt: str(j.created_at),
    updatedAt: str(j.updated_at),
    dueDate: str(j.due_date) || undefined,
    description: str(j.description),
  };
}

/** True for an entry of GitHub's issue list that is a pull request (the list has both). */
export function isGitHubPullRequest(j: Json): boolean {
  return j.pull_request !== undefined && j.pull_request !== null;
}

/** A GitHub issue (REST API, `GET /repos/:owner/:repo/issues`). */
export function issueFromGitHub(j: Json): Issue {
  const login = (u: unknown) => str(obj(u).login);
  return {
    id: Number(j.number),
    title: str(j.title),
    url: str(j.html_url),
    author: login(j.user),
    authorName: login(j.user),
    assignees: arr(j.assignees).map(login),
    labels: arr(j.labels).map((l) => (typeof l === "string" ? l : str(obj(l).name))),
    milestone: str(obj(j.milestone).title) || undefined,
    comments: typeof j.comments === "number" ? j.comments : undefined,
    confidential: false,
    createdAt: str(j.created_at),
    updatedAt: str(j.updated_at),
    description: str(j.body),
  };
}

/**
 * Suggested branch for an issue, GitLab's convention: `<id>-<title-in-kebab-case>`
 * (`12-fix-the-login-page`), the slug cut at a word boundary to stay short.
 */
export function issueBranchName(issue: Pick<Issue, "id" | "title">, maxSlug = 50): string {
  const slug = issue.title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let cut = slug;
  if (cut.length > maxSlug) {
    cut = cut.slice(0, maxSlug + 1);
    const dash = cut.lastIndexOf("-");
    cut = dash > 0 ? cut.slice(0, dash) : cut.slice(0, maxSlug);
  }
  return cut ? `${issue.id}-${cut}` : `${issue.id}`;
}
