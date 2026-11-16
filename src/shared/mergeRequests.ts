// Merge requests (GitLab) and pull requests (GitHub) in one shape. Pure functions, no VS Code
// dependency (unit-tested).

export interface MergeRequest {
  /** GitLab `iid`, GitHub `number`. */
  id: number;
  title: string;
  url: string;
  source: string;
  target: string;
  /** Username / login of the author. */
  author: string;
  authorName: string;
  assignees: string[];
  reviewers: string[];
  draft: boolean;
  /** GitLab only. */
  conflicts?: boolean;
  /** GitLab `detailed_merge_status` (`mergeable`, `ci_still_running`…). */
  status?: string;
  labels: string[];
  comments?: number;
  createdAt: string;
  updatedAt: string;
  description: string;
  /** Commit at the head of the source branch. */
  headSha?: string;
  /** The source branch lives in another project (a fork). */
  fork: boolean;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);

/** A GitLab merge request (REST API v4, `GET /projects/:id/merge_requests`). */
export function fromGitLab(j: Json): MergeRequest {
  const user = (u: unknown) => str(obj(u).username);
  return {
    id: Number(j.iid),
    title: str(j.title),
    url: str(j.web_url),
    source: str(j.source_branch),
    target: str(j.target_branch),
    author: user(j.author),
    authorName: str(obj(j.author).name) || user(j.author),
    assignees: arr(j.assignees).map(user),
    reviewers: arr(j.reviewers).map(user),
    draft: j.draft === true || j.work_in_progress === true,
    conflicts: j.has_conflicts === true,
    status: str(j.detailed_merge_status) || undefined,
    labels: arr(j.labels).map((l) => (typeof l === "string" ? l : str(obj(l).name))),
    comments: typeof j.user_notes_count === "number" ? j.user_notes_count : undefined,
    createdAt: str(j.created_at),
    updatedAt: str(j.updated_at),
    description: str(j.description),
    headSha: str(j.sha) || undefined,
    fork:
      j.source_project_id !== undefined &&
      j.target_project_id !== undefined &&
      j.source_project_id !== j.target_project_id,
  };
}

/** A GitHub pull request (REST API, `GET /repos/:owner/:repo/pulls`). */
export function fromGitHub(j: Json): MergeRequest {
  const login = (u: unknown) => str(obj(u).login);
  const head = obj(j.head);
  const base = obj(j.base);
  const repoName = (side: Json) => str(obj(side.repo).full_name);
  return {
    id: Number(j.number),
    title: str(j.title),
    url: str(j.html_url),
    source: str(head.ref),
    target: str(base.ref),
    author: login(j.user),
    authorName: login(j.user),
    assignees: arr(j.assignees).map(login),
    reviewers: arr(j.requested_reviewers).map(login),
    draft: j.draft === true,
    labels: arr(j.labels).map((l) => str(obj(l).name)),
    createdAt: str(j.created_at),
    updatedAt: str(j.updated_at),
    description: str(j.body),
    headSha: str(head.sha) || undefined,
    fork: !!repoName(head) && repoName(head) !== repoName(base),
  };
}

/** Short status text for the description column (draft, conflicts, pipeline…). */
export function statusText(m: MergeRequest): string {
  const parts: string[] = [];
  if (m.draft) parts.push("draft");
  if (m.conflicts) parts.push("conflicts");
  const status: Record<string, string> = {
    ci_still_running: "pipeline running",
    ci_must_pass: "pipeline must pass",
    not_approved: "needs approval",
    discussions_not_resolved: "open threads",
    need_rebase: "needs rebase",
    blocked_status: "blocked",
  };
  if (m.status && status[m.status]) parts.push(status[m.status]);
  return parts.join(", ");
}
