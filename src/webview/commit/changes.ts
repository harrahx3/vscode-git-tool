// The changed files under the commit message: changelists with their files, checkboxes choosing
// what gets committed, multi-selection (Ctrl/Shift+click, arrows), native right-click menus
// (`data-vscode-context`, `webview/context` in package.json), row buttons, and drag and drop of
// files between changelists with pointer events (HTML5 drag does nothing in a VS Code webview).
import type {
  ChangeListView,
  ChangeRow,
  CommitFromWebview,
  CommitRowCommand,
  RowContext,
} from "../../shared/messages";
import { h, icon } from "../common/dom";

type Row =
  | { kind: "group"; key: string; group: ChangeListView }
  | { kind: "file"; key: string; group: ChangeListView; file: ChangeRow };

const STATUS_CLASS: Record<string, string> = {
  M: "modified",
  T: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "renamed",
  U: "conflict",
  "?": "untracked",
};
const STATUS_TITLE: Record<string, string> = {
  M: "Modified",
  T: "Type changed",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Conflict",
  "?": "Unversioned",
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface ChangesOptions {
  send: (m: CommitFromWebview) => void;
  collapsed: Set<string>;
  onCollapse: () => void;
}

export class ChangesList {
  readonly element = h("div.changes", { tabindex: 0, role: "tree", "aria-label": "Changes" });
  private readonly notice = h("div.notice", { hidden: true });
  private readonly rowsBox = h("div.rows");
  private readonly ghost = h("div.drag-ghost", { hidden: true });
  private lists: ChangeListView[] = [];
  private rows: Row[] = [];
  private selected = new Set<string>();
  private anchor?: string;
  private focusKey?: string;

  constructor(private readonly o: ChangesOptions) {
    this.element.append(this.notice, this.rowsBox, this.ghost);
    this.element.addEventListener("keydown", (e) => this.onKey(e));
  }

  update(lists: ChangeListView[], notice?: string): void {
    this.lists = lists;
    this.notice.textContent = notice ?? "";
    this.notice.hidden = !notice;
    this.render();
  }

  // ---- Rendering ------------------------------------------------------------------------------

  private render(): void {
    this.rows = [];
    for (const group of this.lists) {
      if (group.kind !== "changelist" && !group.files.length) continue;
      this.rows.push({ kind: "group", key: group.key, group });
      if (!this.o.collapsed.has(group.key))
        for (const file of group.files)
          this.rows.push({ kind: "file", key: `file:${file.path}`, group, file });
    }
    const known = new Set(this.rows.map((r) => r.key));
    const before = this.selected.size;
    this.selected = new Set([...this.selected].filter((k) => known.has(k)));
    if (this.selected.size !== before) this.postSelection();
    if (this.focusKey && !known.has(this.focusKey)) this.focusKey = undefined;
    this.rowsBox.replaceChildren(...this.rows.map((r) => this.rowElement(r)));
    this.o.send({
      type: "status",
      files: this.rows.flatMap((r) => (r.kind === "file" ? [r.file.path] : [])),
      notice: this.notice.hidden ? undefined : (this.notice.textContent ?? undefined),
    });
  }

  private rowElement(row: Row): HTMLElement {
    const el = row.kind === "group" ? this.groupRow(row.group) : this.fileRow(row.group, row.file);
    el.dataset.key = row.key;
    el.setAttribute("data-vscode-context", JSON.stringify(this.context(row)));
    el.classList.toggle("selected", this.selected.has(row.key));
    el.classList.toggle("focused", this.focusKey === row.key);
    el.addEventListener("click", (e) => this.onClick(e, row));
    el.addEventListener("contextmenu", () => this.onContextMenu(row));
    if (row.kind === "file") el.addEventListener("pointerdown", (e) => this.onPointerDown(e, row));
    return el;
  }

  private context(row: Row): RowContext {
    if (row.kind === "file")
      return {
        webviewSection: "change",
        path: row.file.path,
        list: row.group.name,
        untracked: row.file.untracked,
        conflict: row.file.conflict,
      };
    const g = row.group;
    if (g.kind === "changelist")
      return {
        webviewSection: "changelist",
        list: g.name,
        active: g.active,
        empty: !g.files.length,
      };
    return { webviewSection: g.kind };
  }

  private checkbox(state: boolean | "mixed", paths: () => string[]): HTMLInputElement {
    const box = h("input.tick", { type: "checkbox", "aria-label": "Include in commit" });
    box.checked = state === true;
    box.indeterminate = state === "mixed";
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("pointerdown", (e) => e.stopPropagation());
    box.addEventListener("change", () =>
      this.o.send({ type: "include", paths: paths(), on: box.checked }),
    );
    return box;
  }

  private button(name: string, title: string, command: CommitRowCommand, row: Row): HTMLElement {
    const b = h("button.row-button", { title, "aria-label": title }, icon(name));
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      this.o.send({ type: "run", command, target: this.context(row) });
    });
    return b;
  }

  private groupRow(g: ChangeListView): HTMLElement {
    const open = !this.o.collapsed.has(g.key);
    const row: Row = { kind: "group", key: g.key, group: g };
    const ticked = g.files.filter((f) => f.included).length;
    const state = ticked === 0 ? false : ticked === g.files.length ? true : "mixed";
    const twisty = h(
      "span.twisty",
      {},
      g.files.length ? icon(open ? "chevron-down" : "chevron-right") : null,
    );
    const buttons = h("span.row-buttons");
    if (g.kind === "conflicts")
      buttons.append(
        this.button("git-merge", "Resolve Conflicts…", "gitTool.operation.resolve", row),
      );
    else if (g.kind === "changelist" && g.files.length)
      buttons.append(this.button("discard", "Rollback…", "gitTool.change.rollback", row));
    const el = h(
      `div.row.group.${g.kind}` as "div",
      { role: "treeitem", "aria-expanded": g.files.length ? String(open) : undefined },
      twisty,
      g.kind === "conflicts"
        ? icon("warning")
        : g.files.length
          ? this.checkbox(state, () => this.pathsOf(row, true))
          : h("span.tick-space"),
      h("span.name", { text: g.name }),
      h("span.dim", { text: (g.active ? "active · " : "") + plural(g.files.length, "file") }),
      buttons,
    );
    el.title =
      g.kind === "conflicts"
        ? "Files to resolve: click one to open it in the merge editor"
        : g.kind === "unversioned"
          ? "Files git does not track yet"
          : `Changelist ${g.name}${g.active ? " (active: new changes join it)" : ""}`;
    twisty.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle(g.key);
    });
    el.addEventListener("dblclick", () => this.toggle(g.key));
    return el;
  }

  private fileRow(g: ChangeListView, f: ChangeRow): HTMLElement {
    const row: Row = { kind: "file", key: `file:${f.path}`, group: g, file: f };
    const slash = f.path.lastIndexOf("/");
    const buttons = h("span.row-buttons");
    if (f.conflict)
      buttons.append(
        this.button("git-merge", "Resolve in Merge Editor", "gitTool.change.resolve", row),
      );
    else {
      buttons.append(this.button("go-to-file", "Open File", "gitTool.change.open", row));
      buttons.append(
        f.untracked
          ? this.button("trash", "Delete…", "gitTool.change.delete", row)
          : this.button("discard", "Rollback…", "gitTool.change.rollback", row),
      );
    }
    const el = h(
      `div.row.file.st-${STATUS_CLASS[f.status] ?? "modified"}` as "div",
      { role: "treeitem" },
      h("span.twisty"),
      f.conflict ? h("span.tick-space") : this.checkbox(f.included, () => this.pathsOf(row, true)),
      h("span.name", { text: f.path.slice(slash + 1) }),
      h("span.dim", { text: slash >= 0 ? f.path.slice(0, slash) : "" }),
      buttons,
      h("span.status", { text: f.status === "?" ? "U" : f.status === "U" ? "!" : f.status }),
    );
    el.title = `${f.oldPath ? `${f.oldPath} → ` : ""}${f.path} • ${STATUS_TITLE[f.status] ?? ""}`;
    return el;
  }

  private toggle(key: string): void {
    if (this.o.collapsed.has(key)) this.o.collapsed.delete(key);
    else this.o.collapsed.add(key);
    this.o.onCollapse();
    this.render();
  }

  // ---- Selection ------------------------------------------------------------------------------

  /** Files of a row; with `followSelection`, of the whole selection when it holds the row. */
  private pathsOf(row: Row, followSelection: boolean, onlyMovable = false): string[] {
    const keys =
      followSelection && this.selected.has(row.key) && this.selected.size > 1
        ? [...this.selected]
        : [row.key];
    const out = new Set<string>();
    for (const k of keys) {
      const r = this.rows.find((x) => x.key === k) ?? (k === row.key ? row : undefined);
      const groupOf = r?.kind === "group" ? r.group : undefined;
      const files = groupOf
        ? groupOf.files
        : r?.kind === "file"
          ? [r.file]
          : this.lists.flatMap((l) => l.files).filter((f) => `file:${f.path}` === k);
      for (const f of files) if (!f.conflict && (!onlyMovable || !f.untracked)) out.add(f.path);
    }
    return [...out];
  }

  private postSelection(): void {
    this.o.send({ type: "selection", keys: [...this.selected] });
  }

  private select(keys: string[], focus: string): void {
    this.selected = new Set(keys);
    this.focusKey = focus;
    this.postSelection();
    for (const el of this.rowsBox.children as HTMLCollectionOf<HTMLElement>) {
      el.classList.toggle("selected", this.selected.has(el.dataset.key!));
      el.classList.toggle("focused", el.dataset.key === focus);
    }
    this.rowsBox
      .querySelector<HTMLElement>(`[data-key="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  private range(from: string, to: string): string[] {
    const a = this.rows.findIndex((r) => r.key === from);
    const b = this.rows.findIndex((r) => r.key === to);
    if (a < 0 || b < 0) return [to];
    return this.rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.key);
  }

  private onClick(e: MouseEvent, row: Row): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.element.focus();
    if (e.shiftKey && this.anchor) return this.select(this.range(this.anchor, row.key), row.key);
    this.anchor = row.key;
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(this.selected);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return this.select([...next], row.key);
    }
    this.select([row.key], row.key);
    this.activate(row);
  }

  /** A click on a file: its diff, or the merge editor for a conflict. */
  private activate(row: Row): void {
    if (row.kind === "group") {
      if (row.group.files.length) this.toggle(row.key);
      return;
    }
    const command = row.file.conflict ? "gitTool.change.resolve" : "gitTool.change.diff";
    this.o.send({ type: "run", command, target: this.context(row) });
  }

  private onContextMenu(row: Row): void {
    // Like Source Control: right-clicking outside the selection selects that row only.
    if (!this.selected.has(row.key)) {
      this.anchor = row.key;
      this.select([row.key], row.key);
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.rows.length) return;
    const i = this.rows.findIndex((r) => r.key === this.focusKey);
    const row = i >= 0 ? this.rows[i] : undefined;
    const move = (to: number) => {
      const target = this.rows[Math.max(0, Math.min(this.rows.length - 1, to))];
      if (e.shiftKey && this.anchor) this.select(this.range(this.anchor, target.key), target.key);
      else {
        this.anchor = target.key;
        this.select([target.key], target.key);
      }
    };
    if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i < 0 ? 0 : i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(this.rows.length - 1);
    else if ((e.key === "a" || e.key === "A") && (e.ctrlKey || e.metaKey)) {
      this.select(
        this.rows.map((r) => r.key),
        this.focusKey ?? this.rows[0].key,
      );
    } else if (!row) return;
    else if (e.key === " ") {
      const paths = this.pathsOf(row, true);
      const files = this.lists.flatMap((l) => l.files).filter((f) => paths.includes(f.path));
      if (paths.length)
        this.o.send({ type: "include", paths, on: !files.every((f) => f.included) });
    } else if (e.key === "Enter") this.activate(row);
    else if (e.key === "ArrowRight" && row.kind === "group" && this.o.collapsed.has(row.key))
      this.toggle(row.key);
    else if (e.key === "ArrowLeft" && row.kind === "group" && !this.o.collapsed.has(row.key))
      this.toggle(row.key);
    else return;
    e.preventDefault();
  }

  // ---- Drag and drop between changelists ------------------------------------------------------

  private suppressClick = false;

  private onPointerDown(e: PointerEvent, row: Row): void {
    if (e.button !== 0 || row.kind !== "file") return;
    const target = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let paths: string[] | undefined;
    let over: HTMLElement | undefined;
    const dropTarget = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>(".row");
      const key = el?.dataset.key;
      const r = this.rows.find((x) => x.key === key);
      return r && r.group.kind === "changelist" ? { el: el!, list: r.group.name } : undefined;
    };
    const move = (ev: PointerEvent) => {
      if (!paths) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        paths = this.pathsOf(row, true, true);
        if (!paths.length) return cleanup();
        target.setPointerCapture(ev.pointerId);
        this.ghost.textContent =
          paths.length === 1 ? (paths[0].split("/").pop() ?? paths[0]) : `${paths.length} files`;
        this.ghost.hidden = false;
        this.element.classList.add("dragging");
      }
      this.ghost.style.left = `${ev.clientX + 12}px`;
      this.ghost.style.top = `${ev.clientY + 8}px`;
      const t = dropTarget(ev);
      if (over !== t?.el) {
        over?.classList.remove("drop-target");
        over = t?.el;
        over?.classList.add("drop-target");
      }
    };
    const up = (ev: PointerEvent) => {
      const t = paths ? dropTarget(ev) : undefined;
      if (paths) this.suppressClick = true;
      if (paths && t && t.list !== row.group.name)
        this.o.send({ type: "move", paths, list: t.list });
      cleanup();
      // The click that follows a drag is swallowed; none follows when the pointer left the row.
      setTimeout(() => (this.suppressClick = false), 0);
    };
    const cleanup = () => {
      over?.classList.remove("drop-target");
      this.ghost.hidden = true;
      this.element.classList.remove("dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}
