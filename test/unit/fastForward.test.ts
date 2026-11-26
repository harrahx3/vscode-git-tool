import { describe, expect, it } from "vitest";
import { fastForwardStatus, fastForwardSummary, remoteOf } from "../../src/shared/fastForward";
import type { Ref } from "../../src/shared/types";

const head = (name: string, extra: Partial<Ref> = {}): Ref => ({
  name,
  kind: "head",
  hash: `${name}-hash`,
  ...extra,
});
const remote = (name: string): Ref => ({ name, kind: "remote", hash: `${name}-hash` });

describe("fastForwardStatus", () => {
  const all = [remote("origin/main"), remote("origin/feature"), head("main")];

  it("moves a branch that is only behind to its upstream's commit", () => {
    const b = head("feature", { upstream: "origin/feature", behind: 3 });
    expect(fastForwardStatus(b, all)).toEqual({
      kind: "move",
      upstream: "origin/feature",
      from: "feature-hash",
      to: "origin/feature-hash",
      count: 3,
    });
  });

  it("follows a local upstream branch", () => {
    const b = head("topic", { upstream: "main", behind: 1 });
    expect(fastForwardStatus(b, all)).toMatchObject({ kind: "move", to: "main-hash" });
  });

  it("leaves alone a branch with local commits, up to date, or without upstream", () => {
    expect(
      fastForwardStatus(head("f", { upstream: "origin/feature", ahead: 2, behind: 1 }), all),
    ).toEqual({ kind: "diverged", upstream: "origin/feature", ahead: 2, behind: 1 });
    expect(fastForwardStatus(head("f", { upstream: "origin/feature", ahead: 2 }), all).kind).toBe(
      "upToDate",
    );
    expect(fastForwardStatus(head("f"), all).kind).toBe("noUpstream");
    expect(fastForwardStatus(head("f", { upstream: "origin/gone", behind: 1 }), all).kind).toBe(
      "upstreamGone",
    );
  });

  it("does not move a branch checked out in another worktree", () => {
    const b = head("feature", { upstream: "origin/feature", behind: 1 });
    expect(fastForwardStatus(b, all, "/wt/feature")).toEqual({
      kind: "checkedOut",
      upstream: "origin/feature",
      path: "/wt/feature",
    });
  });
});

describe("remoteOf", () => {
  it("takes the longest remote name the upstream starts with", () => {
    expect(remoteOf("origin/feature/x", ["origin", "up"])).toBe("origin");
    expect(remoteOf("team/a/main", ["team", "team/a"])).toBe("team/a");
    expect(remoteOf("main", ["origin"])).toBeUndefined();
  });
});

describe("fastForwardSummary", () => {
  it("reports one branch in one sentence", () => {
    expect(
      fastForwardSummary([
        {
          name: "feature",
          status: { kind: "move", upstream: "origin/feature", from: "a", to: "b", count: 1 },
        },
      ]),
    ).toEqual({ message: "feature fast-forwarded to origin/feature (1 commit).", warning: false });
  });

  it("groups several branches and warns about the ones not updated", () => {
    const { message, warning } = fastForwardSummary([
      { name: "a", status: { kind: "move", upstream: "origin/a", from: "1", to: "2", count: 2 } },
      { name: "b", status: { kind: "upToDate", upstream: "origin/b" } },
      { name: "c", status: { kind: "diverged", upstream: "origin/c", ahead: 1, behind: 4 } },
    ]);
    expect(warning).toBe(true);
    expect(message).toBe(
      "Fast-forwarded 1 branch: a (+2). Up to date: b. Not updated: c has diverged from origin/c (1 local, 4 incoming): check it out to merge or rebase.",
    );
  });
});
