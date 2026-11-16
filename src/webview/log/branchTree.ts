// Branches pane of the Log: HEAD, Local, Remote (per remote), Tags; names split into folders on "/".
import { buildFolders, sortedFolders, sortedRefs, type RefFolder } from "../../shared/refFolders";
import type { HeadInfo, Ref, RefKind } from "../../shared/types";
import { h, icon, menuContext } from "../common/dom";

export interface BranchTreeEvents {
  /** Single click: jump to the ref's commit. */
  reveal(ref: Ref): void;
  /** Double click: show only this branch's history. */
  filter(ref: Ref): void;
}

export class BranchTree {
  readonly el = h("div.branch-tree", { role: "tree", tabindex: 0 });
  private readonly list = h("div.branch-list");
  private readonly search = h("input.search", { type: "search", placeholder: "Filter branches" });
  /** Collapsed folder keys, e.g. `remote:origin/feat`. Tags start collapsed. */
  private collapsed = new Set<string>(["section:tag"]);
  private refs: Ref[] = [];
  private head: HeadInfo = {};

  constructor(private readonly events: BranchTreeEvents) {
    this.search.addEventListener("input", () => this.render());
    this.el.append(h("div.pane-toolbar", {}, this.search), this.list);
  }

  setRefs(refs: Ref[], head: HeadInfo): void {
    this.refs = refs;
    this.head = head;
    this.render();
  }

  private render(): void {
    const query = this.search.value.trim().toLowerCase();
    const match = (r: Ref) => !query || r.name.toLowerCase().includes(query);
    const rows: HTMLElement[] = [];
    const current = this.refs.find((r) => r.kind === "head" && r.name === this.head.branch);
    rows.push(
      this.item(
        0,
        icon("target"),
        `HEAD (${this.head.branch ?? (this.head.hash ? "detached" : "no commits")})`,
        current,
        "head-node",
      ),
    );
    const sections: [string, RefKind][] = [
      ["Local", "head"],
      ["Remote", "remote"],
      ["Tags", "tag"],
    ];
    for (const [title, kind] of sections) {
      const refs = this.refs.filter((r) => r.kind === kind && match(r));
      if (!refs.length) continue;
      const key = `section:${kind}`;
      const open = !this.collapsed.has(key) || !!query;
      rows.push(this.folderRow(0, title, key, open, refs.length));
      if (open) this.renderFolder(buildFolders(refs), 1, kind, "", rows, !!query);
    }
    this.list.replaceChildren(...rows);
  }

  private renderFolder(
    folder: RefFolder,
    depth: number,
    kind: RefKind,
    prefix: string,
    rows: HTMLElement[],
    expandAll: boolean,
  ): void {
    for (const [name, sub] of sortedFolders(folder)) {
      const key = `${kind}:${prefix}${name}`;
      const open = expandAll || !this.collapsed.has(key);
      rows.push(this.folderRow(depth, name, key, open));
      if (open) this.renderFolder(sub, depth + 1, kind, `${prefix}${name}/`, rows, expandAll);
    }
    for (const { ref, leaf } of sortedRefs(folder)) {
      const isCurrent = kind === "head" && ref.name === this.head.branch;
      const track = [ref.ahead ? `↑${ref.ahead}` : "", ref.behind ? `↓${ref.behind}` : ""]
        .filter(Boolean)
        .join(" ");
      rows.push(
        this.item(
          depth,
          icon(kind === "tag" ? "tag" : isCurrent ? "check" : "git-branch"),
          leaf,
          ref,
          isCurrent ? "current" : "",
          track,
        ),
      );
    }
  }

  private folderRow(depth: number, label: string, key: string, open: boolean, count?: number) {
    const row = h(
      "div.tree-row.folder",
      { style: `padding-left:${depth * 14 + 4}px`, role: "treeitem", "aria-expanded": open },
      icon(open ? "chevron-down" : "chevron-right"),
      h("span.label", { text: label }),
      count !== undefined ? h("span.count", { text: String(count) }) : null,
    );
    row.addEventListener("click", () => {
      if (this.collapsed.has(key)) this.collapsed.delete(key);
      else this.collapsed.add(key);
      this.render();
    });
    return row;
  }

  private item(
    depth: number,
    glyph: HTMLElement,
    label: string,
    ref: Ref | undefined,
    cls = "",
    track = "",
  ): HTMLElement {
    const row = h(
      `div.tree-row.branch-ref${cls ? "." + cls : ""}` as "div",
      {
        style: `padding-left:${depth * 14 + 20}px`,
        role: "treeitem",
        title: ref ? `${ref.name}${ref.upstream ? ` → ${ref.upstream}` : ""}` : undefined,
        "data-vscode-context": ref
          ? menuContext({
              webviewSection: "ref",
              refName: ref.name,
              refKind: ref.kind,
              isCurrent: ref.kind === "head" && ref.name === this.head.branch,
            })
          : undefined,
      },
      glyph,
      h("span.label", { text: label }),
      track ? h("span.track", { text: track }) : null,
    );
    if (ref) {
      row.addEventListener("click", () => this.events.reveal(ref));
      row.addEventListener("dblclick", () => this.events.filter(ref));
    } else if (this.head.hash) {
      const hash = this.head.hash;
      row.addEventListener("click", () => this.events.reveal({ name: "HEAD", kind: "head", hash }));
    }
    return row;
  }
}
