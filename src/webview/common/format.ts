// Formatting helpers (pure, tested in test/unit/format.test.ts).

const two = (n: number) => String(n).padStart(2, "0");

/**
 * PyCharm-like date column: "Today 14:05", "Yesterday 09:12", then "2026-11-02 17:40".
 * `now` is injectable for tests.
 */
export function formatLogDate(seconds: number, now: Date = new Date()): string {
  const d = new Date(seconds * 1000);
  const time = `${two(d.getHours())}:${two(d.getMinutes())}`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday && t < startOfToday + 86_400_000) return `Today ${time}`;
  if (t >= startOfToday - 86_400_000 && t < startOfToday) return `Yesterday ${time}`;
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${time}`;
}

export function formatFullDate(seconds: number): string {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(
    d.getMinutes(),
  )}`;
}

/** Splits `a/b/c.ts` into `{ dir: "a/b", name: "c.ts" }`. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { dir: "", name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}

/** Groups paths by directory, directories sorted, files sorted within. */
export function groupByDirectory<T extends { path: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const { dir } = splitPath(item.path);
    const list = groups.get(dir) ?? [];
    list.push(item);
    groups.set(dir, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, list]) => [dir, list.sort((x, y) => x.path.localeCompare(y.path))]);
}
