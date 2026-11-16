import { describe, expect, it } from "vitest";
import { layoutGraph } from "../../src/shared/graph";

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe("layoutGraph", () => {
  it("keeps a linear history in lane 0 with one colour", () => {
    const rows = layoutGraph([c("c", "b"), c("b", "a"), c("a")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0]);
    expect(new Set(rows.map((r) => r.color)).size).toBe(1);
    // The root commit has an incoming line from the top and nothing below.
    expect(rows[2].segments).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 0.5, color: 0 }]);
    // The tip has no line above it.
    expect(rows[0].segments.some((s) => s.y1 === 0)).toBe(false);
  });

  it("opens a lane for the second parent of a merge and closes it at the fork", () => {
    //  m  merge of b into a2
    //  |\
    //  a2 b
    //  |/
    //  a1
    const rows = layoutGraph([c("m", "a2", "b"), c("a2", "a1"), c("b", "a1"), c("a1")]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 1, 0]);
    expect(rows[0].width).toBe(2);
    expect(rows[0].segments).toContainEqual({ x1: 0, y1: 0.5, x2: 1, y2: 1, color: rows[2].color });
    // b's first parent a1 is already awaited in lane 0: b bends back into it.
    expect(rows[2].segments).toContainEqual({ x1: 1, y1: 0.5, x2: 0, y2: 1, color: rows[2].color });
    expect(rows[3].width).toBe(1);
    expect(rows[2].color).not.toBe(rows[0].color);
  });

  it("gives two branch tips their own lanes and reuses freed lanes", () => {
    const rows = layoutGraph([
      c("x", "base"),
      c("y", "base"),
      c("base", "root"),
      c("z"),
      c("root"),
    ]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 1, 0]);
    // y's parent is already awaited in lane 0: y bends into it at once, freeing lane 1 for z.
    expect(rows[1].segments).toContainEqual({ x1: 1, y1: 0.5, x2: 0, y2: 1, color: rows[1].color });
    expect(rows[2].width).toBe(1);
  });

  it("tolerates parents outside the loaded range (lane runs to the bottom)", () => {
    const rows = layoutGraph([c("b", "missing")]);
    expect(rows[0].segments).toEqual([{ x1: 0, y1: 0.5, x2: 0, y2: 1, color: 0 }]);
  });
});
