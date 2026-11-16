// Web links of a Git remote (GitLab, GitHub, Bitbucket): repository, branch, tag, commit, file,
// merge requests and issues. Pure functions, no VS Code dependency (unit-tested).

export type Provider = "gitlab" | "github" | "bitbucket";

export interface RemoteInfo {
  provider: Provider;
  host: string;
  /** Project path on the host, without `.git`: `group/subgroup/repo`, `owner/repo`. */
  path: string;
  /** Web page of the project: `https://host/group/subgroup/repo`. */
  web: string;
}

/**
 * Host and project path of a remote URL: `git@host:group/repo.git`,
 * `ssh://git@host:2222/group/repo.git`, `https://user@host/group/repo.git`. Undefined for a local
 * path or a URL without a project path.
 */
export function parseRemoteUrl(
  url: string,
): { scheme: "https" | "http"; host: string; path: string } | undefined {
  const text = url.trim();
  let scheme: "https" | "http" = "https";
  let host: string;
  let rest: string;
  const withScheme = /^([a-z][a-z0-9+.-]*):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(text);
  const scp = /^(?:[^@/:]+@)?([^/:]+):(?!\/\/)(.+)$/.exec(text);
  if (withScheme) {
    const proto = withScheme[1].toLowerCase();
    if (proto === "file") return undefined;
    if (proto === "http") scheme = "http";
    [host, rest] = [withScheme[2], withScheme[3]];
  } else if (scp && scp[1].length > 1) {
    // scp-like syntax (`C:\repo`, a drive letter, is a local path).
    [host, rest] = [scp[1], scp[2]];
  } else return undefined;
  const path = rest
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/^\/+/, "");
  // A host without a dot is an SSH alias or a local name: its web address is unknown.
  if (!path || !host.includes(".")) return undefined;
  return { scheme, host: host.toLowerCase(), path };
}

/**
 * The hosting service of a remote. `overrides` maps a host to its provider (setting
 * `gitTool.hostingProviders`); otherwise github.com and bitbucket.org are recognised, hosts named
 * after GitHub or Bitbucket too, and any other host is taken as a GitLab instance.
 */
export function remoteInfo(
  url: string,
  overrides: Record<string, string> = {},
): RemoteInfo | undefined {
  const parsed = parseRemoteUrl(url);
  if (!parsed) return undefined;
  const { scheme, host, path } = parsed;
  const override = Object.entries(overrides).find(([h]) => h.toLowerCase() === host)?.[1];
  const provider: Provider =
    override === "github" || override === "gitlab" || override === "bitbucket"
      ? override
      : host === "github.com" || host.includes("github")
        ? "github"
        : host === "bitbucket.org" || host.includes("bitbucket")
          ? "bitbucket"
          : "gitlab";
  return { provider, host, path, web: `${scheme}://${host}/${path}` };
}

/** Encodes each segment of a branch or file path, keeping the slashes. */
const segments = (p: string) => p.split("/").map(encodeURIComponent).join("/");
const query = (q: string) => encodeURIComponent(q);

/** What the service calls a merge request. */
export function mergeRequestWord(provider: Provider): string {
  return provider === "gitlab" ? "Merge Request" : "Pull Request";
}

/** `!12` on GitLab, `#12` elsewhere. */
export function mergeRequestRef(provider: Provider, id: number): string {
  return `${provider === "gitlab" ? "!" : "#"}${id}`;
}

export function repositoryUrl(r: RemoteInfo): string {
  return r.web;
}

export function branchUrl(r: RemoteInfo, branch: string): string {
  const b = segments(branch);
  if (r.provider === "gitlab") return `${r.web}/-/tree/${b}`;
  if (r.provider === "github") return `${r.web}/tree/${b}`;
  return `${r.web}/branch/${b}`;
}

export function tagUrl(r: RemoteInfo, tag: string): string {
  const t = segments(tag);
  if (r.provider === "gitlab") return `${r.web}/-/tags/${t}`;
  if (r.provider === "github") return `${r.web}/releases/tag/${t}`;
  return `${r.web}/src/${t}`;
}

export function commitUrl(r: RemoteInfo, hash: string): string {
  if (r.provider === "gitlab") return `${r.web}/-/commit/${hash}`;
  if (r.provider === "github") return `${r.web}/commit/${hash}`;
  return `${r.web}/commits/${hash}`;
}

/** A file at a ref (branch, tag or commit), optionally with a line range (1-based). */
export function fileUrl(
  r: RemoteInfo,
  ref: string,
  filePath: string,
  lines?: [number, number],
): string {
  const base = `${segments(ref)}/${segments(filePath)}`;
  let anchor = "";
  if (lines) {
    const [from, to] = lines;
    const single = from === to;
    if (r.provider === "gitlab") anchor = single ? `#L${from}` : `#L${from}-${to}`;
    else if (r.provider === "github") anchor = single ? `#L${from}` : `#L${from}-L${to}`;
    else anchor = single ? `#lines-${from}` : `#lines-${from}:${to}`;
  }
  if (r.provider === "gitlab") return `${r.web}/-/blob/${base}${anchor}`;
  if (r.provider === "github") return `${r.web}/blob/${base}${anchor}`;
  return `${r.web}/src/${base}${anchor}`;
}

export function mergeRequestsUrl(r: RemoteInfo): string {
  if (r.provider === "gitlab") return `${r.web}/-/merge_requests`;
  if (r.provider === "github") return `${r.web}/pulls`;
  return `${r.web}/pull-requests`;
}

export function mergeRequestUrl(r: RemoteInfo, id: number): string {
  if (r.provider === "gitlab") return `${r.web}/-/merge_requests/${id}`;
  if (r.provider === "github") return `${r.web}/pull/${id}`;
  return `${r.web}/pull-requests/${id}`;
}

/** The open merge requests whose source is `branch` (the web search, no API needed). */
export function branchMergeRequestsUrl(r: RemoteInfo, branch: string): string {
  if (r.provider === "gitlab")
    return `${r.web}/-/merge_requests?state=opened&source_branch=${query(branch)}`;
  if (r.provider === "github") return `${r.web}/pulls?q=${query(`is:pr is:open head:${branch}`)}`;
  return `${r.web}/pull-requests?state=OPEN`;
}

/** The page that creates a merge request from `source` (into `target`, else the default). */
export function newMergeRequestUrl(r: RemoteInfo, source: string, target?: string): string {
  if (r.provider === "gitlab")
    return (
      `${r.web}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${query(source)}` +
      (target ? `&merge_request%5Btarget_branch%5D=${query(target)}` : "")
    );
  if (r.provider === "github")
    return `${r.web}/compare/${target ? `${segments(target)}...` : ""}${segments(source)}?expand=1`;
  return `${r.web}/pull-requests/new?source=${query(source)}${target ? `&dest=${query(target)}` : ""}`;
}

export function issuesUrl(r: RemoteInfo): string {
  if (r.provider === "gitlab") return `${r.web}/-/issues`;
  return `${r.web}/issues`;
}

/** The page that creates an issue. */
export function newIssueUrl(r: RemoteInfo): string {
  if (r.provider === "gitlab") return `${r.web}/-/issues/new`;
  return `${r.web}/issues/new`;
}

/** REST API root of the service, with a trailing slash. */
export function apiRoot(r: RemoteInfo): string | undefined {
  const scheme = r.web.slice(0, r.web.indexOf("://"));
  if (r.provider === "gitlab") return `${scheme}://${r.host}/api/v4/`;
  if (r.provider === "github")
    return r.host === "github.com" ? "https://api.github.com/" : `${scheme}://${r.host}/api/v3/`;
  return undefined;
}

/** API path of the project: `projects/group%2Frepo` (GitLab), `repos/owner/repo` (GitHub). */
export function apiProject(r: RemoteInfo): string {
  return r.provider === "gitlab" ? `projects/${encodeURIComponent(r.path)}` : `repos/${r.path}`;
}

/** Ref that holds a merge request's head on the target remote. */
export function mergeRequestHeadRef(provider: Provider, id: number): string {
  return provider === "gitlab" ? `refs/merge-requests/${id}/head` : `refs/pull/${id}/head`;
}
