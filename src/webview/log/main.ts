// Log tab: toolbar of filters, branches pane | commit table | details pane.
import { layoutGraph } from "../../shared/graph";
import type { LogFromWebview, LogToWebview, RepoEntry } from "../../shared/messages";
import type { Commit, HeadInfo, LogFilter, Ref } from "../../shared/types";
import {
  debounce,
  h,
  icon,
  iconButton,
  loadState,
  makeSplitter,
  post,
  saveState,
} from "../common/dom";
import { svgIcon } from "../common/icons";
import { BranchTree } from "./branchTree";
import { DetailsPane } from "./details";
import { CommitTable } from "./table";

const PAGE = 1000;

interface State {
  filter: LogFilter;
  branchesWidth: number;
  detailsWidth: number;
  showBranches: boolean;
  showDetails: boolean;
}

const state = loadState<State>({
  filter: {},
  branchesWidth: 200,
  detailsWidth: 380,
  showBranches: true,
  showDetails: true,
});
let limit = PAGE;
let requestId = 0;
let loading = false;
let hasMore = false;
let refs: Ref[] = [];
let head: HeadInfo = {};
let commits: Commit[] = [];
/** Commit to select when the next result arrives. */
let pendingSelect: string | undefined;
let firstLoad = true;

const send = (m: LogFromWebview) => post(m);
const persist = () => saveState(state);

// ---- Layout ---------------------------------------------------------------------------------

const app = document.getElementById("app")!;
const details = new DetailsPane({
  openDiff: (d, f) =>
    send({
      type: "openDiff",
      hash: d.hash,
      parent: d.parents[0],
      path: f.path,
      oldPath: f.oldPath,
    }),
  selectCommit: (hash) => selectCommit(hash),
});
const table = new CommitTable({
  select: debounce((hash: string) => send({ type: "details", hash }), 60),
  selectionChanged: (hashes) => {
    send({ type: "selection", hashes });
    selectionText.textContent = hashes.length > 1 ? `${hashes.length} selected` : "";
  },
  nearEnd: () => {
    if (hasMore && !loading) {
      limit += PAGE;
      query(false);
    }
  },
});
const tree = new BranchTree({
  reveal: (ref) => selectCommit(ref.hash),
  filter: (ref) =>
    setFilter({ ...state.filter, branch: ref.name, hashes: undefined, label: undefined }),
});

const repoSelect = h("select.repo", { title: "Repository" });
const textInput = h("input.filter-text", {
  type: "search",
  placeholder: "Text or hash",
  title: "Filter by message text or hash (case-insensitive)",
});
const branchSelect = h("select.filter-branch", { title: "Branch" });
const authorList = h("datalist", { id: "authors" });
const authorInput = h("input.filter-author", {
  type: "search",
  placeholder: "User",
  list: "authors",
  title: "Filter by author name or email",
});
const chips = h("span.chips");
const status = h("span.status-text");
const selectionText = h("span.status-text.selection-count");
const errorBar = h("div.error-bar", { hidden: true });

const branchesPane = h("div.pane.branches-pane", {}, tree.el);
const detailsPane = h("div.pane.details-pane", {}, details.el);
const leftSplit = h("div.splitter", { title: "Drag to resize" });
const rightSplit = h("div.splitter", { title: "Drag to resize" });
const header = h(
  "div.table-header",
  {},
  h("div.cell.cell-subject", { text: "Subject" }),
  h("div.cell.cell-author", { text: "Author" }),
  h("div.cell.cell-date", { text: "Date" }),
  h("div.cell.cell-hash", { text: "Hash" }),
);
const center = h("div.pane.table-pane", {}, header, table.el);

const toggleBranches = iconButton("list-tree", "Show/hide branches", () => {
  state.showBranches = !state.showBranches;
  applyPanes();
});
const toggleDetails = iconButton("layout-sidebar-right", "Show/hide commit details", () => {
  state.showDetails = !state.showDetails;
  applyPanes();
});

app.append(
  h(
    "div.toolbar",
    {},
    toggleBranches,
    repoSelect,
    h("span.field", {}, icon("search"), textInput),
    h("label.field", {}, h("span.field-label", { text: "Branch:" }), branchSelect),
    h("span.field", {}, icon("person"), authorInput),
    authorList,
    chips,
    h("span.spacer"),
    selectionText,
    status,
    iconButton("refresh", "Refresh", () => send({ type: "refresh" })),
    iconButton(svgIcon("branch-new"), "New branch…", () =>
      send({ type: "command", command: "gitTool.newBranch" }),
    ),
    iconButton(svgIcon("branch-checkout"), "Checkout…", () =>
      send({ type: "command", command: "gitTool.checkout" }),
    ),
    iconButton("tag", "New tag on HEAD…", () =>
      send({ type: "command", command: "gitTool.newTag" }),
    ),
    iconButton("git-compare", "Compare branches…", () =>
      send({ type: "command", command: "gitTool.compareBranches" }),
    ),
    iconButton("repo-fetch", "Fetch all remotes", () =>
      send({ type: "command", command: "gitTool.fetch" }),
    ),
    iconButton("arrow-down", "Pull", () => send({ type: "command", command: "gitTool.update" })),
    iconButton("arrow-up", "Push…", () => send({ type: "command", command: "gitTool.push" })),
    toggleDetails,
  ),
  errorBar,
  h("div.main", {}, branchesPane, leftSplit, center, rightSplit, detailsPane),
);

makeSplitter(leftSplit, branchesPane, "left", (w) => {
  state.branchesWidth = w;
  persist();
});
makeSplitter(rightSplit, detailsPane, "right", (w) => {
  state.detailsWidth = w;
  persist();
});

function applyPanes(): void {
  branchesPane.hidden = leftSplit.hidden = !state.showBranches;
  detailsPane.hidden = rightSplit.hidden = !state.showDetails;
  branchesPane.style.width = `${state.branchesWidth}px`;
  detailsPane.style.width = `${state.detailsWidth}px`;
  toggleBranches.classList.toggle("active", state.showBranches);
  toggleDetails.classList.toggle("active", state.showDetails);
  persist();
}
applyPanes();

// ---- Filters --------------------------------------------------------------------------------

textInput.value = state.filter.text ?? "";
authorInput.value = state.filter.author ?? "";

textInput.addEventListener(
  "input",
  debounce(() => setFilter({ ...state.filter, text: textInput.value.trim() || undefined }), 300),
);
authorInput.addEventListener(
  "input",
  debounce(
    () => setFilter({ ...state.filter, author: authorInput.value.trim() || undefined }),
    300,
  ),
);
branchSelect.addEventListener("change", () =>
  setFilter({ ...state.filter, branch: branchSelect.value || undefined }),
);
repoSelect.addEventListener("change", () => send({ type: "selectRepo", root: repoSelect.value }));

function setFilter(filter: LogFilter, select?: string): void {
  state.filter = filter;
  textInput.value = filter.text ?? "";
  authorInput.value = filter.author ?? "";
  persist();
  renderBranchOptions();
  renderChips();
  limit = PAGE;
  pendingSelect = select;
  query(true);
}

function renderChips(): void {
  const f = state.filter;
  const items: [string, string, () => void][] = [];
  if (f.hashes)
    items.push([
      "selection",
      `History of ${f.label ?? "selection"}`,
      () => setFilter({ ...f, hashes: undefined, label: undefined }),
    ]);
  else if (f.path)
    items.push(["file", `Path: ${f.path}`, () => setFilter({ ...f, path: undefined })]);
  chips.replaceChildren(
    ...items.map(([glyph, text, clear]) => {
      const chip = h("span.chip", { title: text }, icon(glyph), h("span", { text }));
      chip.append(iconButton("close", "Clear this filter", clear));
      return chip;
    }),
  );
}

function renderBranchOptions(): void {
  const opts: HTMLOptionElement[] = [
    h("option", { value: "", text: "All" }),
    h("option", { value: "HEAD", text: "HEAD (current)" }),
  ];
  const group = (label: string, list: Ref[]) => {
    if (!list.length) return;
    const g = h("optgroup", { label });
    for (const r of list) g.append(h("option", { value: r.name, text: r.name }));
    opts.push(g as unknown as HTMLOptionElement);
  };
  group(
    "Local",
    refs.filter((r) => r.kind === "head"),
  );
  group(
    "Remote",
    refs.filter((r) => r.kind === "remote"),
  );
  const b = state.filter.branch;
  if (b && b !== "HEAD" && !refs.some((r) => r.name === b && r.kind !== "tag"))
    opts.push(h("option", { value: b, text: state.filter.label ?? b }));
  branchSelect.replaceChildren(...opts);
  branchSelect.value = b ?? "";
}

function query(showLoading: boolean): void {
  loading = true;
  requestId++;
  if (showLoading) status.textContent = "Loading…";
  send({ type: "query", requestId, filter: state.filter, limit });
}

function selectCommit(hash: string): void {
  const found = table.resolve(hash);
  if (found) return table.select(found);
  if (
    state.filter.branch ||
    state.filter.text ||
    state.filter.author ||
    state.filter.path ||
    state.filter.hashes
  ) {
    setFilter({}, hash);
    return;
  }
  if (hasMore) {
    pendingSelect = hash;
    limit = Math.max(limit, 20 * PAGE);
    query(true);
    return;
  }
  send({ type: "details", hash });
}

function onCommits(m: Extract<LogToWebview, { type: "commits" }>): void {
  if (m.requestId !== requestId) return;
  loading = false;
  hasMore = m.hasMore;
  commits = m.commits;
  table.setData(commits, m.graph ? layoutGraph(commits) : null, refs, head);
  status.textContent = `${commits.length}${hasMore ? "+" : ""} commit${commits.length === 1 ? "" : "s"}`;
  const authors = [...new Set(commits.map((c) => c.author))].sort().slice(0, 200);
  authorList.replaceChildren(...authors.map((a) => h("option", { value: a })));
  if (pendingSelect) {
    const target = table.resolve(pendingSelect);
    if (target) {
      pendingSelect = undefined;
      table.select(target);
    } else if (hasMore && limit < 20 * PAGE) {
      limit = 20 * PAGE;
      query(true);
    } else {
      send({ type: "details", hash: pendingSelect });
      pendingSelect = undefined;
    }
  } else if (commits.length && (firstLoad || !table.selected || !table.has(table.selected))) {
    table.select(head.hash && table.has(head.hash) ? head.hash : commits[0].hash);
  } else if (!commits.length) {
    const filtered = state.filter.text || state.filter.author;
    details.clear(filtered ? "No commits match the filter." : "No commits.");
  }
  firstLoad = false;
}

function onRepos(repos: RepoEntry[], current?: string): void {
  repoSelect.replaceChildren(
    ...repos.map((r) => h("option", { value: r.root, text: r.name, title: r.root })),
  );
  repoSelect.hidden = repos.length <= 1;
  if (current) repoSelect.value = current;
  if (!repos.length) details.clear("No Git repository is open.");
}

window.addEventListener("message", (event: MessageEvent<LogToWebview>) => {
  const m = event.data;
  switch (m.type) {
    case "repos":
      onRepos(m.repos, m.current);
      break;
    case "refs":
      refs = m.refs;
      head = m.head;
      tree.setRefs(refs, head);
      renderBranchOptions();
      renderChips();
      errorBar.hidden = true;
      query(firstLoad);
      break;
    case "commits":
      onCommits(m);
      break;
    case "details":
      if (m.details.hash === table.selected || !table.has(m.details.hash)) details.show(m.details);
      break;
    case "setFilter":
      setFilter(m.filter, m.select);
      break;
    case "select":
      selectCommit(m.hash);
      break;
    case "error":
      loading = false;
      status.textContent = "";
      errorBar.textContent = m.message;
      errorBar.hidden = false;
      break;
  }
});

send({ type: "ready" });
