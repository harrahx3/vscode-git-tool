// Branch and tag names split into folders on "/" (`feat/log/graph` → feat › log › graph), as in
// PyCharm's branches tree. Shared by the Log's branches pane and the native Branches view.
import type { Ref } from "./types";

export interface RefFolder {
  folders: Map<string, RefFolder>;
  refs: { ref: Ref; leaf: string }[];
}

export function buildFolders(refs: Ref[]): RefFolder {
  const root: RefFolder = { folders: new Map(), refs: [] };
  for (const ref of refs) {
    const parts = ref.name.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.folders.get(part);
      if (!next) {
        next = { folders: new Map(), refs: [] };
        node.folders.set(part, next);
      }
      node = next;
    }
    node.refs.push({ ref, leaf: parts[parts.length - 1] });
  }
  return root;
}

/** Sub-folders sorted by name. */
export const sortedFolders = (f: RefFolder): [string, RefFolder][] =>
  [...f.folders.entries()].sort(([a], [b]) => a.localeCompare(b));

/** Refs of a folder sorted by their last name segment. */
export const sortedRefs = (f: RefFolder): RefFolder["refs"] =>
  [...f.refs].sort((a, b) => a.leaf.localeCompare(b.leaf));
