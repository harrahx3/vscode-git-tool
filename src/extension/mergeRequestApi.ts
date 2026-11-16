// Read-only merge request queries (GitLab merge requests, GitHub pull requests).
import { fromGitHub, fromGitLab, type MergeRequest } from "../shared/mergeRequests";
import { apiProject } from "../shared/remote";
import type { Hosting, HostingApi } from "./hosting";

type Json = Record<string, unknown>;

const normalize = (h: Hosting, list: Json[]) =>
  list.map((j) => (h.provider === "gitlab" ? fromGitLab(j) : fromGitHub(j)));

function assertSupported(h: Hosting): void {
  if (h.provider === "bitbucket")
    throw new Error("Listing pull requests is not supported for Bitbucket yet.");
}

/** Open merge requests of the project, most recently updated first (first 100). */
export async function openMergeRequests(
  api: HostingApi,
  h: Hosting,
  sourceBranch?: string,
): Promise<MergeRequest[]> {
  assertSupported(h);
  const project = apiProject(h);
  const branch = sourceBranch ? encodeURIComponent(sourceBranch) : "";
  const owner = h.path.split("/")[0];
  const path =
    h.provider === "gitlab"
      ? `${project}/merge_requests?state=opened&order_by=updated_at&per_page=100` +
        (branch ? `&source_branch=${branch}` : "")
      : `${project}/pulls?state=open&sort=updated&direction=desc&per_page=100` +
        (branch ? `&head=${encodeURIComponent(owner)}:${branch}` : "");
  return normalize(h, await api.get<Json[]>(h, path));
}

/** Merge requests (any state) that contain the commit. */
export async function commitMergeRequests(
  api: HostingApi,
  h: Hosting,
  hash: string,
): Promise<MergeRequest[]> {
  assertSupported(h);
  const project = apiProject(h);
  const path =
    h.provider === "gitlab"
      ? `${project}/repository/commits/${hash}/merge_requests`
      : `${project}/commits/${hash}/pulls`;
  return normalize(h, await api.get<Json[]>(h, path));
}

/** Username (GitLab) or login (GitHub) of the signed-in user. */
export async function currentUser(api: HostingApi, h: Hosting): Promise<string | undefined> {
  const user = await api.get<Json>(h, "user");
  const name = h.provider === "gitlab" ? user.username : user.login;
  return typeof name === "string" ? name : undefined;
}
