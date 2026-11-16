import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  isSortKey,
  SORT_ORDERS,
  sortItems,
  type Sortable,
} from "../../src/shared/sorting";

const item = (id: number, over: Partial<Sortable>): Sortable => ({
  id,
  title: `Item ${id}`,
  authorName: "zoe",
  assignees: [],
  createdAt: `2026-01-0${id}T00:00:00Z`,
  updatedAt: `2026-02-0${id}T00:00:00Z`,
  ...over,
});
const items = [
  item(1, { authorName: "bob", assignees: ["carol"], title: "beta" }),
  item(2, { authorName: "Alice", assignees: [], title: "Alpha" }),
  item(3, { authorName: "alice", assignees: ["Bob", "zed"], title: "item 10" }),
  item(4, { authorName: "bob", assignees: ["carol"], title: "item 9" }),
];
const ids = (key: Parameters<typeof sortItems>[1]) => sortItems(items, key).map((i) => i.id);

describe("sortItems", () => {
  it("dates and numbers newest first", () => {
    expect(ids("updated")).toEqual([4, 3, 2, 1]);
    expect(ids("created")).toEqual([4, 3, 2, 1]);
    expect(ids("id")).toEqual([4, 3, 2, 1]);
  });

  it("names A–Z ignoring case, ties by most recent update", () => {
    expect(ids("author")).toEqual([3, 2, 4, 1]);
    expect(ids("title")).toEqual([2, 1, 4, 3]);
  });

  it("assignee: first assignee A–Z, unassigned last", () => {
    expect(ids("assignee")).toEqual([3, 4, 1, 2]);
  });

  it("does not change the input", () => {
    const before = items.map((i) => i.id);
    sortItems(items, "title");
    expect(items.map((i) => i.id)).toEqual(before);
  });

  it("knows its keys", () => {
    expect(isSortKey(DEFAULT_SORT)).toBe(true);
    expect(isSortKey("size")).toBe(false);
    expect(SORT_ORDERS.map((o) => o.key)).toContain("assignee");
  });
});
