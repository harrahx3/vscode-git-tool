// Virtualised commit table: graph + subject with ref labels, author, date, hash.
import type { GraphRow } from "../../shared/graph";
import type { Commit, HeadInfo, Ref } from "../../shared/types";
import { h, menuContext } from "../common/dom";
import { formatLogDate } from "../common/format";
import { LANE_WIDTH, ROW_HEIGHT, graphSvg, laneColor } from "./graphSvg";

export interface TableEvents {
  /** The focused commit (shown in the details pane) changed. */
  select(hash: string): void;
  /** The set of selected commits changed (Ctrl/Shift+click, Shift+arrows). */
  selectionChanged?(hashes: string[]): void;
  /** The user scrolled near the end of the loaded commits. */
  nearEnd(): void;
}

interface Label {
  text: string;
  kind: "head" | "remote" | "tag" | "headpointer";
  current: boolean;
  /** Ref the label's context menu acts on. */
  ref?: Ref;
}

/** PyCharm merges a local branch and its remote twin on the same commit into "origin & main". */
export function labelsFor(refs: Ref[], head: HeadInfo): Label[] {
  const labels: Label[] = [];
  const locals = refs.filter((r) => r.kind === "head");
  const remotes = refs.filter((r) => r.kind === "remote");
  const usedRemotes = new Set<Ref>();
  for (const local of locals) {
    const branchOf = (r: Ref) => r.name.slice(r.name.indexOf("/") + 1);
    const twin = remotes.find((r) => branchOf(r) === local.name);
    let text = local.name;
    if (twin && !usedRemotes.has(twin)) {
      usedRemotes.add(twin);
      text = `${twin.name.slice(0, twin.name.indexOf("/"))} & ${local.name}`;
    }
    labels.push({ text, kind: "head", current: local.name === head.branch, ref: local });
  }
  for (const r of remotes)
    if (!usedRemotes.has(r)) labels.push({ text: r.name, kind: "remote", current: false, ref: r });
  for (const r of refs.filter((x) => x.kind === "tag"))
    labels.push({ text: r.name, kind: "tag", current: false, ref: r });
  // Current branch first.
  return labels.sort((a, b) => Number(b.current) - Number(a.current));
}

export class CommitTable {
  readonly el = h("div.table-scroll", { tabindex: 0, role: "grid", "aria-label": "Commits" });
  private readonly spacer = h("div.table-spacer");
  private readonly layer = h("div.table-rows");
  private commits: Commit[] = [];
  private graph: GraphRow[] | null = null;
  private refsByHash = new Map<string, Ref[]>();
  private head: HeadInfo = {};
  private index = new Map<string, number>();
  /** The focused commit, whose details are shown. */
  selected?: string;
  /** All selected commits (the focused one included). */
  private selection = new Set<string>();
  /** Where a Shift+click or Shift+arrow range starts. */
  private anchor?: string;
  private frame = 0;

  constructor(private readonly events: TableEvents) {
    this.spacer.append(this.layer);
    this.el.append(this.spacer);
    this.el.addEventListener("scroll", () => this.schedule());
    new ResizeObserver(() => this.schedule()).observe(this.el);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("mousedown", (e) => this.pick(e));
    this.el.addEventListener("contextmenu", (e) => this.pick(e));
  }

  setData(commits: Commit[], graph: GraphRow[] | null, refs: Ref[], head: HeadInfo): void {
    this.commits = commits;
    this.graph = graph;
    this.head = head;
    this.refsByHash = new Map();
    for (const r of refs) {
      const list = this.refsByHash.get(r.hash) ?? [];
      list.push(r);
      this.refsByHash.set(r.hash, list);
    }
    this.index = new Map(commits.map((c, i) => [c.hash, i]));
    const kept = [...this.selection].filter((x) => this.index.has(x));
    if (kept.length !== this.selection.size) {
      this.selection = new Set(kept);
      this.events.selectionChanged?.(this.selectedHashes());
    }
    this.spacer.style.height = `${commits.length * ROW_HEIGHT}px`;
    this.renderNow();
  }

  has(hash: string): boolean {
    return this.index.has(hash);
  }

  /** Finds a loaded commit by full hash or unique prefix. */
  resolve(prefix: string): string | undefined {
    if (this.index.has(prefix)) return prefix;
    return this.commits.find((c) => c.hash.startsWith(prefix))?.hash;
  }

  /** Selected commits in table order (newest first). */
  selectedHashes(): string[] {
    return [...this.selection].sort((a, b) => (this.index.get(a) ?? 0) - (this.index.get(b) ?? 0));
  }

  /** Selects one commit only. */
  select(hash: string, reveal = true): void {
    this.selection = new Set([hash]);
    this.anchor = hash;
    this.focus(hash, reveal);
  }

  /** Moves the focus (details pane) to `hash`, keeping the selection. */
  private focus(hash: string, reveal = true): void {
    this.selected = hash;
    this.selection.add(hash);
    this.events.selectionChanged?.(this.selectedHashes());
    const i = this.index.get(hash);
    if (reveal && i !== undefined) {
      const top = i * ROW_HEIGHT;
      const view = this.el.clientHeight;
      if (top < this.el.scrollTop) this.el.scrollTop = top;
      else if (top + ROW_HEIGHT > this.el.scrollTop + view)
        this.el.scrollTop = top - view + ROW_HEIGHT * 3;
    }
    this.renderNow();
    this.events.select(hash);
  }

  /** Selection by mouse, like a native list: Ctrl/Cmd toggles, Shift extends from the anchor. */
  private pick(e: MouseEvent): void {
    const hash = (e.target as HTMLElement).closest<HTMLElement>(".row")?.dataset.hash;
    if (!hash) return;
    // A right-click inside the selection keeps it: the menu then acts on all selected commits.
    if (e.type === "contextmenu" || e.button === 2) {
      if (!this.selection.has(hash)) this.select(hash, false);
      return;
    }
    if (e.button !== 0) return;
    if (e.shiftKey) {
      e.preventDefault();
      this.selectRange(hash);
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      this.toggle(hash);
    } else if (hash !== this.selected || this.selection.size > 1) {
      this.select(hash, false);
    }
  }

  private toggle(hash: string): void {
    this.anchor = hash;
    if (!this.selection.has(hash)) return this.focus(hash, false);
    if (this.selection.size === 1) return;
    this.selection.delete(hash);
    if (hash === this.selected) this.focus(this.selectedHashes()[0], false);
    else {
      this.events.selectionChanged?.(this.selectedHashes());
      this.renderNow();
    }
  }

  /** Selects every commit between the anchor and `hash`, and focuses `hash`. */
  private selectRange(hash: string, reveal = false): void {
    const from = this.index.get(this.anchor ?? hash) ?? this.index.get(hash)!;
    const to = this.index.get(hash)!;
    const [lo, hi] = from < to ? [from, to] : [to, from];
    this.selection = new Set(this.commits.slice(lo, hi + 1).map((c) => c.hash));
    this.focus(hash, reveal);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.commits.length) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      this.anchor = this.commits[0].hash;
      return this.selectRange(this.commits[this.commits.length - 1].hash);
    }
    const current = this.selected ? (this.index.get(this.selected) ?? -1) : -1;
    const page = Math.max(1, Math.floor(this.el.clientHeight / ROW_HEIGHT) - 1);
    const moves: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      PageDown: current + page,
      PageUp: current - page,
      Home: 0,
      End: this.commits.length - 1,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = Math.min(this.commits.length - 1, Math.max(0, moves[e.key]));
    if (e.shiftKey) this.selectRange(this.commits[next].hash, true);
    else this.select(this.commits[next].hash);
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  private renderNow(): void {
    const top = this.el.scrollTop;
    const height = this.el.clientHeight || 400;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - 5);
    const last = Math.min(this.commits.length, Math.ceil((top + height) / ROW_HEIGHT) + 5);
    const rows: HTMLElement[] = [];
    for (let i = first; i < last; i++) rows.push(this.row(i));
    this.layer.replaceChildren(...rows);
    if (last >= this.commits.length - 50) this.events.nearEnd();
  }

  private row(i: number): HTMLElement {
    const c = this.commits[i];
    const isHead = c.hash === this.head.hash;
    const g = this.graph?.[i];
    const subject = h("span.subject", { text: c.subject, title: c.subject });
    const cell = h("div.cell.cell-subject");
    if (g) {
      const svg = graphSvg(g, isHead);
      cell.append(svg);
      cell.style.paddingLeft = "0";
    } else {
      cell.append(h("span.nograph", { style: `width:${LANE_WIDTH}px` }));
    }
    cell.append(subject);
    const refs = this.refsByHash.get(c.hash);
    if (refs) {
      const labels = h("span.labels");
      for (const l of labelsFor(refs, this.head)) {
        const color = g && l.kind !== "tag" ? laneColor(g.color) : undefined;
        const label = h(`span.ref.ref-${l.kind}${l.current ? ".current" : ""}` as "span", {
          title: l.text,
          style: color ? `--lane:${color}` : undefined,
          "data-vscode-context": l.ref
            ? menuContext({
                webviewSection: "ref",
                refName: l.ref.name,
                refKind: l.ref.kind,
                isCurrent: l.current,
              })
            : undefined,
        });
        label.append(
          h(`span.codicon.codicon-${l.kind === "tag" ? "tag" : "git-branch"}` as "span"),
          l.text,
        );
        labels.append(label);
      }
      cell.append(labels);
    }
    if (isHead) subject.classList.add("head");
    const inSelection = this.selection.has(c.hash);
    const multi = inSelection && this.selection.size > 1;
    const classes = `${inSelection ? ".selected" : ""}${c.hash === this.selected ? ".focused" : ""}`;
    return h(
      `div.row${classes}` as "div",
      {
        role: "row",
        "aria-selected": inSelection ? "true" : undefined,
        "data-hash": c.hash,
        style: `top:${i * ROW_HEIGHT}px`,
        // On a multi-selection the menu offers the actions on several commits ("commits").
        "data-vscode-context": menuContext(
          multi
            ? // The hashes themselves reach the host as a "selection" message.
              {
                webviewSection: "commits",
                hash: c.hash,
                count: this.selection.size,
                isPair: this.selection.size === 2,
              }
            : { webviewSection: "commit", hash: c.hash, parents: c.parents, isHead },
        ),
      },
      cell,
      h("div.cell.cell-author", { text: c.author, title: `${c.author} <${c.email}>` }),
      h("div.cell.cell-date", { text: formatLogDate(c.authorTime) }),
      h("div.cell.cell-hash", { text: c.hash.slice(0, 8) }),
    );
  }
}
