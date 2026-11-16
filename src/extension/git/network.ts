// Fetch and push through VS Code's Git extension. No VS Code dependency (unit-tested).

/** The network part of the Git extension's repository API (version 1). */
export interface NetworkApi {
  fetch(options?: { remote?: string; ref?: string; all?: boolean; prune?: boolean }): Promise<void>;
  /** `force`: the Git extension's ForcePushMode (1 = force with lease). */
  push(remote?: string, refspec?: string, setUpstream?: boolean, force?: number): Promise<void>;
}

const FORCE_WITH_LEASE = 1;

/**
 * Maps the fetch and push commands this extension runs onto the Git extension's API, which
 * asks for credentials (askpass, GitHub sign-in) like Source Control. Undefined for other
 * shapes, which then run as plain git.
 */
export function apiNetworkTask(
  repo: NetworkApi,
  args: string[],
): (() => Promise<void>) | undefined {
  const [cmd, ...rest] = args;
  const flags = rest.filter((a) => a.startsWith("-"));
  const positional = rest.filter((a) => !a.startsWith("-"));
  if (cmd === "fetch") {
    if (flags.some((f) => f !== "--all" && f !== "--prune") || positional.length > 2)
      return undefined;
    // `fetch --all`, `fetch <remote>` or `fetch <remote> <ref>` (one branch or merge request).
    const all = flags.includes("--all");
    if (all ? positional.length > 0 : positional.length === 0) return undefined;
    const options = {
      all: all || undefined,
      remote: positional[0],
      ref: positional[1],
      prune: flags.includes("--prune"),
    };
    return () => repo.fetch(options);
  }
  if (cmd === "push") {
    const known = ["--force-with-lease", "--set-upstream", "--delete"];
    if (flags.some((f) => !known.includes(f)) || positional.length !== 2) return undefined;
    const [remote, ref] = positional;
    const refspec = flags.includes("--delete") ? `:${ref}` : ref;
    const force = flags.includes("--force-with-lease") ? FORCE_WITH_LEASE : undefined;
    return () => repo.push(remote, refspec, flags.includes("--set-upstream"), force);
  }
  return undefined;
}
