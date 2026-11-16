// Read-only issue queries (GitLab and GitHub issues).
import {
  isGitHubPullRequest,
  issueFromGitHub,
  issueFromGitLab,
  type Issue,
} from "../shared/issues";
import { apiProject } from "../shared/remote";
import type { Hosting, HostingApi } from "./hosting";

type Json = Record<string, unknown>;

/** Open issues of the project, most recently updated first (first 100). */
export async function openIssues(api: HostingApi, h: Hosting): Promise<Issue[]> {
  if (h.provider === "bitbucket")
    throw new Error("Listing issues is not supported for Bitbucket yet.");
  const project = apiProject(h);
  if (h.provider === "gitlab")
    return (
      await api.get<Json[]>(
        h,
        `${project}/issues?state=opened&order_by=updated_at&sort=desc&per_page=100`,
      )
    ).map(issueFromGitLab);
  // GitHub lists pull requests among the issues: leave them out.
  return (
    await api.get<Json[]>(
      h,
      `${project}/issues?state=open&sort=updated&direction=desc&per_page=100`,
    )
  )
    .filter((j) => !isGitHubPullRequest(j))
    .map(issueFromGitHub);
}
