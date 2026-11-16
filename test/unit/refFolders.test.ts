import { describe, expect, it } from "vitest";
import { buildFolders, sortedFolders, sortedRefs } from "../../src/shared/refFolders";
import type { Ref } from "../../src/shared/types";

const ref = (name: string): Ref => ({ name, kind: "head", hash: "0".repeat(40) });

describe("buildFolders", () => {
  it("splits names on / into sorted folders", () => {
    const root = buildFolders(["main", "feat/b", "feat/a", "feat/log/graph"].map(ref));
    expect(sortedRefs(root).map((r) => r.leaf)).toEqual(["main"]);
    const [[name, feat]] = sortedFolders(root);
    expect(name).toBe("feat");
    expect(sortedRefs(feat).map((r) => r.ref.name)).toEqual(["feat/a", "feat/b"]);
    expect(sortedFolders(feat).map(([n]) => n)).toEqual(["log"]);
  });
});
