// PyCharm-style changelists: named groups of changed files, stored per repository in the
// workspace state (git knows nothing about them).
import type * as vscode from "vscode";
import type { Changelist } from "../shared/messages";

export const DEFAULT_CHANGELIST = "Changes";

interface Stored {
  lists: string[];
  active: string;
  /** path → changelist; files not listed belong to the active changelist. */
  assignment: Record<string, string>;
}

export class Changelists {
  constructor(private readonly memento: vscode.Memento) {}

  private key(root: string): string {
    return `changelists:${root}`;
  }

  private load(root: string): Stored {
    const s = this.memento.get<Stored>(this.key(root));
    if (!s || !s.lists?.length)
      return { lists: [DEFAULT_CHANGELIST], active: DEFAULT_CHANGELIST, assignment: {} };
    if (!s.lists.includes(s.active)) s.active = s.lists[0];
    return { lists: [...s.lists], active: s.active, assignment: { ...s.assignment } };
  }

  private async save(root: string, s: Stored): Promise<void> {
    await this.memento.update(this.key(root), s);
  }

  /**
   * Lists and the changelist of each changed path. New changes join the active changelist and
   * stay there (PyCharm behaviour); assignments of files that are no longer changed are dropped.
   */
  async snapshot(
    root: string,
    changedPaths: string[],
  ): Promise<{ changelists: Changelist[]; assignment: Record<string, string> }> {
    const s = this.load(root);
    const assignment: Record<string, string> = {};
    let dirty = false;
    for (const p of changedPaths) {
      const list = s.assignment[p];
      if (list && s.lists.includes(list)) assignment[p] = list;
      else {
        assignment[p] = s.active;
        dirty = true;
      }
    }
    if (dirty || Object.keys(s.assignment).length !== changedPaths.length) {
      s.assignment = assignment;
      await this.save(root, s);
    }
    return {
      changelists: s.lists.map((name) => ({ name, active: name === s.active })),
      assignment,
    };
  }

  names(root: string): string[] {
    return this.load(root).lists;
  }

  async move(root: string, paths: string[], list: string): Promise<void> {
    const s = this.load(root);
    if (!s.lists.includes(list)) s.lists.push(list);
    for (const p of paths) s.assignment[p] = list;
    await this.save(root, s);
  }

  async create(root: string, name: string, makeActive: boolean): Promise<void> {
    const s = this.load(root);
    if (!s.lists.includes(name)) s.lists.push(name);
    if (makeActive) s.active = name;
    await this.save(root, s);
  }

  async setActive(root: string, name: string): Promise<void> {
    const s = this.load(root);
    if (s.lists.includes(name)) s.active = name;
    await this.save(root, s);
  }

  async rename(root: string, from: string, to: string): Promise<void> {
    const s = this.load(root);
    if (!s.lists.includes(from) || s.lists.includes(to)) return;
    s.lists = s.lists.map((n) => (n === from ? to : n));
    if (s.active === from) s.active = to;
    for (const [p, l] of Object.entries(s.assignment)) if (l === from) s.assignment[p] = to;
    await this.save(root, s);
  }

  /** Deletes a changelist; its files go to the active one (or the first remaining list). */
  async remove(root: string, name: string): Promise<void> {
    const s = this.load(root);
    if (s.lists.length <= 1) return;
    s.lists = s.lists.filter((n) => n !== name);
    if (s.active === name) s.active = s.lists[0];
    for (const [p, l] of Object.entries(s.assignment)) if (l === name) s.assignment[p] = s.active;
    await this.save(root, s);
  }
}
