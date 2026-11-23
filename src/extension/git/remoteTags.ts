// Which tags exist on the remote, so that local-only tags can be drawn dashed. One
// `git ls-remote --tags` per repository, cached briefly; any failure (offline, no remote,
// authentication needed) means "unknown", and then no tag is flagged as unpushed.
import type { Git } from "./runner";

const TTL_MS = 60_000;
const TIMEOUT_MS = 4_000;
const cache = new Map<string, { at: number; tags: Promise<Set<string> | undefined> }>();

async function query(git: Git): Promise<Set<string> | undefined> {
  try {
    const remotes = (await git.run(["remote"])).split("\n").filter(Boolean);
    if (!remotes.length) return undefined;
    const remote = remotes.includes("origin") ? "origin" : remotes[0];
    const out = await git.run(["ls-remote", "--tags", "--refs", remote]);
    const names = out
      .split("\n")
      .map((l) => l.split("\t")[1])
      .filter((r): r is string => !!r && r.startsWith("refs/tags/"))
      .map((r) => r.slice(10));
    return new Set(names);
  } catch {
    return undefined;
  }
}

/** Tag names on the remote, or undefined when they cannot be known. */
export function remoteTags(git: Git): Promise<Set<string> | undefined> {
  const hit = cache.get(git.root);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.tags;
  const tags = Promise.race([
    query(git),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), TIMEOUT_MS)),
  ]);
  cache.set(git.root, { at: Date.now(), tags });
  return tags;
}

/** Forgets the cached answer, after a tag was pushed or deleted on the remote. */
export function forgetRemoteTags(git: Git): void {
  cache.delete(git.root);
}
