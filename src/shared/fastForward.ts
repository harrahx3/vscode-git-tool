// Fast-forwarding local branches that are not checked out: whether each one can move to its
// upstream, and the summary shown afterwards. No VS Code dependency (unit-tested in
// test/unit/fastForward.test.ts).
import type { Ref } from "./types";

export type FastForwardStatus =
  | { kind: "move"; upstream: string; from: string; to: string; count: number }
  | { kind: "upToDate"; upstream: string }
  | { kind: "diverged"; upstream: string; ahead: number; behind: number }
  | { kind: "noUpstream" }
  | { kind: "upstreamGone"; upstream: string }
  | { kind: "checkedOut"; upstream: string; path: string };

export interface FastForwardResult {
  name: string;
  status: FastForwardStatus;
}

/**
 * What fast-forwarding `branch` to its upstream would do, from refs read after the fetch.
 * `checkedOutAt`: the worktree the branch is checked out in, whose files would go stale.
 */
export function fastForwardStatus(
  branch: Ref,
  all: Ref[],
  checkedOutAt?: string,
): FastForwardStatus {
  const upstream = branch.upstream;
  if (!upstream) return { kind: "noUpstream" };
  // `origin/main` for a remote upstream, a plain branch name for a local one.
  const target =
    all.find((r) => r.kind === "remote" && r.name === upstream) ??
    all.find((r) => r.kind === "head" && r.name === upstream);
  if (!target) return { kind: "upstreamGone", upstream };
  const ahead = branch.ahead ?? 0;
  const behind = branch.behind ?? 0;
  if (!behind) return { kind: "upToDate", upstream };
  if (ahead) return { kind: "diverged", upstream, ahead, behind };
  if (checkedOutAt) return { kind: "checkedOut", upstream, path: checkedOutAt };
  return { kind: "move", upstream, from: branch.hash, to: target.hash, count: behind };
}

/** The remote an upstream such as `origin/feature/x` belongs to (longest matching name). */
export function remoteOf(upstream: string, remotes: string[]): string | undefined {
  return remotes.filter((r) => upstream.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];
}

const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

function line({ name, status: s }: FastForwardResult): string {
  switch (s.kind) {
    case "move":
      return `${name} fast-forwarded to ${s.upstream} (${commits(s.count)})`;
    case "upToDate":
      return `${name} is up to date with ${s.upstream}`;
    case "diverged":
      return `${name} has diverged from ${s.upstream} (${s.ahead} local, ${s.behind} incoming): check it out to merge or rebase`;
    case "noUpstream":
      return `${name} has no upstream branch`;
    case "upstreamGone":
      return `${name}: its upstream ${s.upstream} no longer exists`;
    case "checkedOut":
      return `${name} is checked out in ${s.path}: pull there`;
  }
}

/** One notification for all the branches; `warning` when one of them could not move. */
export function fastForwardSummary(results: FastForwardResult[]): {
  message: string;
  warning: boolean;
} {
  const warning = results.some((r) => r.status.kind !== "move" && r.status.kind !== "upToDate");
  if (results.length === 1) return { message: `${line(results[0])}.`, warning };
  const moved = results.filter((r) => r.status.kind === "move");
  const upToDate = results.filter((r) => r.status.kind === "upToDate");
  const parts: string[] = [];
  if (moved.length)
    parts.push(
      `Fast-forwarded ${moved.length} branch${moved.length === 1 ? "" : "es"}: ${moved
        .map((r) => `${r.name} (+${r.status.kind === "move" ? r.status.count : 0})`)
        .join(", ")}.`,
    );
  if (upToDate.length) parts.push(`Up to date: ${upToDate.map((r) => r.name).join(", ")}.`);
  const problems = results.filter((r) => r.status.kind !== "move" && r.status.kind !== "upToDate");
  if (problems.length) parts.push(`Not updated: ${problems.map(line).join("; ")}.`);
  return { message: parts.join(" "), warning };
}
