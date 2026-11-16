// Details pane of the Log: changed files (grouped by directory) above the commit message.
import type { ChangedFile, CommitDetails } from "../../shared/types";
import { h, icon, menuContext } from "../common/dom";
import { formatFullDate, groupByDirectory, splitPath } from "../common/format";

export interface DetailsEvents {
  openDiff(details: CommitDetails, file: ChangedFile): void;
  selectCommit(hash: string): void;
}

const STATUS_TITLE: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
  U: "Unmerged",
};

export class DetailsPane {
  readonly el = h("div.details");
  private readonly files = h("div.details-files", { tabindex: 0 });
  private readonly message = h("div.details-message");
  private current?: CommitDetails;
  private selectedPath?: string;

  constructor(private readonly events: DetailsEvents) {
    this.el.append(this.files, h("div.details-split"), this.message);
    this.files.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && this.current && this.selectedPath) {
        const f = this.current.files.find((x) => x.path === this.selectedPath);
        if (f) this.events.openDiff(this.current, f);
      }
    });
    this.clear("Select a commit to see its details.");
  }

  clear(text: string): void {
    this.current = undefined;
    this.files.replaceChildren(h("div.empty", { text }));
    this.message.replaceChildren();
  }

  show(d: CommitDetails): void {
    this.current = d;
    const parent = d.parents[0];
    const rows: HTMLElement[] = [
      h("div.files-header", {
        text: `${d.files.length} file${d.files.length === 1 ? "" : "s"} changed${
          d.parents.length > 1 ? " (against the first parent)" : ""
        }`,
      }),
    ];
    for (const [dir, files] of groupByDirectory(d.files)) {
      if (dir) rows.push(h("div.file-row.dir", {}, icon("folder"), h("span.label", { text: dir })));
      for (const f of files) {
        const { name } = splitPath(f.path);
        const row = h(
          `div.file-row.status-${f.status}${dir ? ".indented" : ""}` as "div",
          {
            title: `${STATUS_TITLE[f.status] ?? f.status}: ${f.oldPath ? `${f.oldPath} → ` : ""}${f.path}`,
            "data-path": f.path,
            "data-vscode-context": menuContext({
              webviewSection: "commitFile",
              hash: d.hash,
              parent,
              path: f.path,
              oldPath: f.oldPath,
              deleted: f.status === "D",
            }),
          },
          h("span.status", { text: f.status }),
          h("span.name", { text: name }),
          f.oldPath ? h("span.from", { text: `← ${f.oldPath}` }) : null,
        );
        row.addEventListener("mousedown", () => this.selectFile(f.path));
        row.addEventListener("contextmenu", () => this.selectFile(f.path));
        row.addEventListener("dblclick", () => this.events.openDiff(d, f));
        rows.push(row);
      }
    }
    this.files.replaceChildren(...rows);

    const [subject, ...body] = d.message.split("\n");
    const meta = h(
      "div.meta",
      {},
      h("span.hash", { text: d.hash.slice(0, 8), title: d.hash }),
      ` by ${d.author} `,
      h("span.dim", { text: `<${d.email}>` }),
      ` on ${formatFullDate(d.authorTime)}`,
    );
    const extra: HTMLElement[] = [];
    if (d.committer !== d.author || d.committerTime !== d.authorTime)
      extra.push(
        h("div.meta.dim", {
          text: `committed by ${d.committer} on ${formatFullDate(d.committerTime)}`,
        }),
      );
    if (d.parents.length) {
      const parents = h("div.meta.dim", {}, d.parents.length > 1 ? "parents " : "parent ");
      for (const p of d.parents) {
        const link = h("a.parent", { href: "#", text: p.slice(0, 8), title: p });
        link.addEventListener("click", (e) => {
          e.preventDefault();
          this.events.selectCommit(p);
        });
        parents.append(link, " ");
      }
      extra.push(parents);
    }
    if (d.refs.length)
      extra.push(h("div.meta", {}, icon("tag"), " ", h("span", { text: d.refs.join(", ") })));
    const text = body.join("\n").trim();
    this.message.replaceChildren(
      h("div.subject", { text: subject }),
      ...(text ? [h("pre.body", { text })] : []),
      meta,
      ...extra,
    );
  }

  private selectFile(path: string): void {
    this.selectedPath = path;
    for (const el of this.files.querySelectorAll<HTMLElement>(".file-row[data-path]"))
      el.classList.toggle("selected", el.dataset.path === path);
  }
}
