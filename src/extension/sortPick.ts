// The "Sort By…" quick pick of the Merge Requests and Issues views, and the stored choice.
import * as vscode from "vscode";
import { DEFAULT_SORT, isSortKey, SORT_ORDERS, type SortKey } from "../shared/sorting";

/** The user's sort order for a view, kept across sessions. */
export class SortSetting {
  constructor(
    private readonly state: vscode.Memento,
    private readonly key: string,
  ) {}

  get(): SortKey {
    const v = this.state.get<unknown>(this.key);
    return isSortKey(v) ? v : DEFAULT_SORT;
  }

  set(sort: SortKey): Thenable<void> {
    return this.state.update(this.key, sort);
  }
}

export const sortLabel = (sort: SortKey): string =>
  SORT_ORDERS.find((o) => o.key === sort)?.label ?? sort;

/** Lets the user pick a sort order; undefined when dismissed. */
export async function pickSort(current: SortKey, what: string): Promise<SortKey | undefined> {
  const picked = await vscode.window.showQuickPick(
    SORT_ORDERS.map((o) => ({
      label: o.key === current ? `$(check) ${o.label}` : `$(blank) ${o.label}`,
      description: o.detail,
      key: o.key,
    })),
    { title: `Sort ${what} By`, placeHolder: `Current: ${sortLabel(current)}` },
  );
  return picked?.key;
}
