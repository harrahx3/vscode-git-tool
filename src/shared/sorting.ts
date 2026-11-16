// Sort order of the Merge Requests and Issues views. Pure functions, no VS Code dependency
// (unit-tested).

export type SortKey = "updated" | "created" | "author" | "assignee" | "title" | "id";

/** The orders a user can pick, in menu order. Dates and numbers newest first, names A–Z. */
export const SORT_ORDERS: { key: SortKey; label: string; detail: string }[] = [
  { key: "updated", label: "Last Updated", detail: "Most recently updated first" },
  { key: "created", label: "Creation Date", detail: "Newest first" },
  { key: "author", label: "Creator", detail: "By author name, A–Z" },
  { key: "assignee", label: "Assignee", detail: "By first assignee, A–Z; unassigned last" },
  { key: "title", label: "Title", detail: "A–Z" },
  { key: "id", label: "Number", detail: "Highest number first" },
];

export const DEFAULT_SORT: SortKey = "updated";

export const isSortKey = (v: unknown): v is SortKey => SORT_ORDERS.some((o) => o.key === v);

/** What both merge requests and issues carry, enough to sort them. */
export interface Sortable {
  id: number;
  title: string;
  authorName: string;
  assignees: string[];
  createdAt: string;
  updatedAt: string;
}

const text = (a: string, b: string) =>
  a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
/** Newest first; a missing date goes last. */
const newest = (a: string, b: string) => (b || "").localeCompare(a || "");

/** A sorted copy (stable: ties keep their order, then fall back to the most recent update). */
export function sortItems<T extends Sortable>(items: T[], key: SortKey): T[] {
  const by: Record<SortKey, (a: T, b: T) => number> = {
    updated: (a, b) => newest(a.updatedAt, b.updatedAt),
    created: (a, b) => newest(a.createdAt, b.createdAt),
    author: (a, b) => text(a.authorName, b.authorName),
    assignee: (a, b) => {
      const x = a.assignees[0] ?? "";
      const y = b.assignees[0] ?? "";
      if (!x !== !y) return x ? -1 : 1;
      return text(x, y);
    },
    title: (a, b) => text(a.title, b.title),
    id: (a, b) => b.id - a.id,
  };
  const compare = by[key];
  return [...items].sort((a, b) => compare(a, b) || newest(a.updatedAt, b.updatedAt));
}
