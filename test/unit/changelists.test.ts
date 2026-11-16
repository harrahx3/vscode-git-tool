import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";
import { Changelists, DEFAULT_CHANGELIST } from "../../src/extension/changelists";

function memento(): vscode.Memento {
  const data = new Map<string, unknown>();
  return {
    keys: () => [...data.keys()],
    get: <T>(key: string, fallback?: T) => (data.has(key) ? (data.get(key) as T) : fallback),
    update: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  } as vscode.Memento;
}

describe("Changelists", () => {
  it("puts new changes in the active list, keeps moved files, forgets committed ones", async () => {
    const lists = new Changelists(memento());
    let snap = await lists.snapshot("/r", ["a", "b"]);
    expect(snap.changelists).toEqual([{ name: DEFAULT_CHANGELIST, active: true }]);
    expect(snap.assignment).toEqual({ a: DEFAULT_CHANGELIST, b: DEFAULT_CHANGELIST });

    await lists.move("/r", ["b"], "Feature");
    await lists.setActive("/r", "Feature");
    snap = await lists.snapshot("/r", ["a", "b", "c"]);
    expect(snap.assignment).toEqual({ a: DEFAULT_CHANGELIST, b: "Feature", c: "Feature" });

    snap = await lists.snapshot("/r", ["c"]);
    expect(snap.assignment).toEqual({ c: "Feature" });
  });

  it("renames and removes lists, moving files to the active one", async () => {
    const lists = new Changelists(memento());
    await lists.snapshot("/r", ["a"]);
    await lists.move("/r", ["a"], "Temp");
    await lists.rename("/r", "Temp", "Spike");
    expect((await lists.snapshot("/r", ["a"])).assignment).toEqual({ a: "Spike" });
    await lists.remove("/r", "Spike");
    expect((await lists.snapshot("/r", ["a"])).assignment).toEqual({ a: DEFAULT_CHANGELIST });
    // The last list cannot be removed.
    await lists.remove("/r", DEFAULT_CHANGELIST);
    expect(lists.names("/r")).toEqual([DEFAULT_CHANGELIST]);
  });
});
