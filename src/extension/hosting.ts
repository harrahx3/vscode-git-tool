// The hosting service behind a Git remote (GitLab, GitHub, Bitbucket): which remote to use, its
// web links, and read-only calls to its REST API for the Merge Requests and Issues views.
//
// API credentials, first match wins: a token saved with "Sign In / Set Access Token…" (VS Code
// secret storage), VS Code's GitHub sign-in (github.com), then the `glab` / `gh` command-line
// tools when they are installed and logged in. Only GET requests are sent.
import { execFile } from "child_process";
import * as vscode from "vscode";
import { apiRoot, remoteInfo, type RemoteInfo } from "../shared/remote";
import { needsCredentials, type CliError } from "./cliError";
import type { Git } from "./git/runner";

export interface Hosting extends RemoteInfo {
  /** Name of the Git remote, e.g. `origin`. */
  remote: string;
}

/** Remote names of the repository. */
export async function remoteNames(git: Git): Promise<string[]> {
  return (await git.run(["remote"])).split("\n").filter(Boolean);
}

/** The remote of the current branch's upstream, else `origin`, else the first remote. */
export async function defaultRemote(git: Git): Promise<string | undefined> {
  const names = await remoteNames(git);
  const upstream = (
    await git.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], {
      okCodes: [128],
    })
  ).trim();
  const fromUpstream = names
    .filter((n) => upstream.startsWith(`${n}/`))
    .sort((a, b) => b.length - a.length)[0];
  return fromUpstream ?? (names.includes("origin") ? "origin" : names[0]);
}

const overrides = () =>
  vscode.workspace.getConfiguration("gitTool").get<Record<string, string>>("hostingProviders", {});

/**
 * The hosting service of `remote` (default: see {@link defaultRemote}), or why there is none (no
 * remote, or a URL that is not a known web host).
 */
export async function findHosting(
  git: Git,
  remote?: string,
): Promise<{ hosting: Hosting } | { problem: string }> {
  const name = remote ?? (await defaultRemote(git));
  if (!name) return { problem: "This repository has no remote." };
  const url = (await git.run(["remote", "get-url", name], { okCodes: [2, 128] })).trim();
  const info = url ? remoteInfo(url, overrides()) : undefined;
  if (!info)
    return {
      problem: `The URL of remote '${name}' (${url || "none"}) is not a GitLab, GitHub or Bitbucket web host.`,
    };
  return { hosting: { ...info, remote: name } };
}

/** Like {@link findHosting}; shows the problem as a warning and returns undefined. */
export async function hostingOf(git: Git, remote?: string): Promise<Hosting | undefined> {
  const found = await findHosting(git, remote);
  if ("hosting" in found) return found.hosting;
  void vscode.window.showWarningMessage(found.problem);
  return undefined;
}

/** `origin/feature/x` → `{ remote: "origin", branch: "feature/x" }`, for a known remote. */
export function splitRemoteRef(
  name: string,
  remotes: string[],
): { remote: string; branch: string } | undefined {
  const remote = remotes
    .filter((r) => name.startsWith(`${r}/`))
    .sort((a, b) => b.length - a.length)[0];
  return remote ? { remote, branch: name.slice(remote.length + 1) } : undefined;
}

/** True when a remote-tracking branch of `remote` contains the commit (it was pushed). */
export async function isOnRemote(git: Git, remote: string, hash: string): Promise<boolean> {
  const out = await git.run(["branch", "-r", "--format=%(refname)", "--contains", hash], {
    okCodes: [129],
  });
  return out.split("\n").some((r) => r.startsWith(`refs/remotes/${remote}/`));
}

// ---- REST API ---------------------------------------------------------------------------------

/** No credentials for the host: the view offers "Sign In / Set Access Token…". */
export class AuthRequired extends Error {}

const secretKey = (h: RemoteInfo) => `gitTool.token.${h.provider}.${h.host}`;

function runCli(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve(stdout),
    ),
  );
}

export class HostingApi implements vscode.Disposable {
  private readonly credentialsChanged = new vscode.EventEmitter<void>();
  /** A token was set or removed: the views reload. */
  readonly onDidChangeCredentials = this.credentialsChanged.event;

  constructor(private readonly secrets: vscode.SecretStorage) {}

  dispose(): void {
    this.credentialsChanged.dispose();
  }

  /** GET `path` (relative to the API root) and parse the JSON answer. */
  async get<T>(h: RemoteInfo, path: string): Promise<T> {
    const root = apiRoot(h);
    if (!root) throw new Error(`The ${h.provider} API is not supported.`);
    const token = await this.secrets.get(secretKey(h));
    if (token) return this.fetchJson<T>(root + path, h, token);
    if (h.provider === "github" && h.host === "github.com") {
      const session = await vscode.authentication.getSession("github", ["repo"], {
        silent: true,
      });
      if (session) return this.fetchJson<T>(root + path, h, session.accessToken);
    }
    const cli = h.provider === "gitlab" ? "glab" : "gh";
    try {
      return JSON.parse(await runCli(cli, ["api", "--hostname", h.host, path])) as T;
    } catch (e) {
      const err = e as CliError;
      // Not installed, or installed but not logged in to this host: ask for credentials.
      if (needsCredentials(err))
        throw new AuthRequired(
          `Sign in to ${h.host} to list merge requests and issues (or log in with \`${cli} auth login\`).`,
          { cause: e },
        );
      throw new Error((err.stderr || err.message || String(e)).trim(), { cause: e });
    }
  }

  private async fetchJson<T>(url: string, h: RemoteInfo, token: string): Promise<T> {
    const headers: Record<string, string> =
      h.provider === "gitlab"
        ? { "PRIVATE-TOKEN": token }
        : { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    const res = await fetch(url, { headers });
    if (res.status === 401)
      throw new AuthRequired(`${h.host} refused the access token (401). Set a new one.`);
    if (!res.ok) throw new Error(`${h.host}: HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  /** Asks for credentials: VS Code's GitHub sign-in on github.com, else an access token. */
  async signIn(h: RemoteInfo): Promise<boolean> {
    if (h.provider === "github" && h.host === "github.com") {
      const session = await vscode.authentication.getSession("github", ["repo"], {
        createIfNone: true,
      });
      if (session) this.credentialsChanged.fire();
      return !!session;
    }
    const scopes = h.provider === "gitlab" ? "read_api" : "repo (read)";
    const token = await vscode.window.showInputBox({
      title: `Access token for ${h.host}`,
      prompt: `A personal access token with the ${scopes} scope. It is kept in VS Code's secret storage.`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!token?.trim()) return false;
    await this.secrets.store(secretKey(h), token.trim());
    this.credentialsChanged.fire();
    return true;
  }

  async signOut(h: RemoteInfo): Promise<void> {
    await this.secrets.delete(secretKey(h));
    this.credentialsChanged.fire();
  }
}
