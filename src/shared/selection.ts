// Selection helpers shared by the views.

/**
 * The nodes a tree menu command acts on. VS Code passes the right-clicked node and the selection:
 * the whole selection when it holds the clicked node, else the clicked node only.
 */
export function treeTargets<T>(clicked: T | undefined, selected: readonly T[] | undefined): T[] {
  if (clicked === undefined) return [...(selected ?? [])];
  return selected?.includes(clicked) ? [...selected] : [clicked];
}

/** A full commit hash shortened for display; branch and tag names are kept. */
export function displayRef(ref: string): string {
  return /^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 8) : ref;
}
