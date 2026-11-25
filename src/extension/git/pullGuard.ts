// Before a pull: which uncommitted changes touch files the upstream also changed (a conflict
// when git re-applies them). After one: the stash git keeps when re-applying it conflicted.
import type { WorkingChange } from "../../shared/types";
import { status } from "./queries";
import type { Git } from "./runner";

/** Paths touched by `git diff --name-status -z -M`, a rename counting for both of its names. Pure. */
export function parseChangedPaths(out: string): Set<string> {
  const parts = out.split("\0").filter(Boolean);
  const paths = new Set<string>();
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    const n = code[0] === "R" || code[0] === "C" ? 2 : 1;
    for (const p of parts.slice(i, i + n)) paths.add(p);
    i += n;
  }
  return paths;
}

/** Uncommitted changes (paths, old paths of renames) that the incoming commits also touch. Pure. */
export function overlap(incoming: Set<string>, local: WorkingChange[]): string[] {
  const hit = new Set<string>();
  for (const c of local) {
    if (c.index === "?") continue; // untracked: git refuses or keeps it, never a content conflict
    for (const p of [c.path, c.oldPath]) if (p && incoming.has(p)) hit.add(c.path);
  }
  return [...hit].sort();
}

/** Local changes that the commits about to be pulled (`@{upstream}`) also change. */
export async function incomingOverlap(git: Git): Promise<string[]> {
  const local = await status(git);
  if (!local.length) return [];
  const out = await git.run(["diff", "--name-status", "-z", "-M", "HEAD...@{upstream}"], {
    okCodes: [1, 128],
  });
  return overlap(parseChangedPaths(out), local);
}

/** True when the newest stash is the one `--autostash` created (git names it "autostash"). */
export async function hasAutostash(git: Git): Promise<boolean> {
  const out = await git.run(["log", "-g", "-1", "--format=%gs", "refs/stash"], {
    okCodes: [1, 128],
  });
  return out.trim() === "autostash";
}

/** Drops the newest stash; call only after {@link hasAutostash}. */
export async function dropAutostash(git: Git): Promise<void> {
  await git.write(["stash", "drop", "-q"]);
}
